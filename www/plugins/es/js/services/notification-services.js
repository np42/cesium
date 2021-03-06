angular.module('cesium.es.notification.services', ['cesium.services', 'cesium.es.http.services'])
.config(function(PluginServiceProvider, csConfig) {
    'ngInject';

    var enable = csConfig.plugins && csConfig.plugins.es;
    if (enable) {
      // Will force to load this service
      PluginServiceProvider.registerEagerLoadingService('esNotification');
    }

  })

.factory('esNotification', function($rootScope, $q, $timeout, esHttp, csConfig, csSettings, csWallet, csWot, UIUtils, BMA, CryptoUtils, Device, Api, esUser) {
  'ngInject';

  function Factory() {

    var listeners,
      defaultLoadSize = 20,
      constants = {
        MESSAGE_CODES: ['MESSAGE_RECEIVED'],
        GROUP_CODES: ['GROUP_INVITATION']
      },
      fields = {
        commons: ["type", "code", "params", "reference", "recipient", "time", "hash", "read_signature"]
      },
      that = this,
      api = new Api(this, 'esNotification')
    ;

    that.raw = {
      postCount: esHttp.post('/user/event/_count'),
      postSearch: esHttp.post('/user/event/_search'),
      postReadById: esHttp.post('/user/event/:id/_read'),
      ws: {
        getUserEvent: esHttp.ws('/ws/event/user/:pubkey/:locale'),
        getChanges: esHttp.ws('/ws/_changes')
      }
    };

    // Create the filter query
    function createFilterQuery(pubkey, options) {
      options = options || {};
      options.codes = options.codes || {};
      options.codes.excludes = options.codes.excludes || constants.MESSAGE_CODES.concat(constants.GROUP_CODES);
      var query = {
        bool: {
          must: [
            {term: {recipient: pubkey}}
          ]
        }
      };

      // Includes codes
      if (options.codes && options.codes.includes) {
        query.bool.must.push({terms: { code: options.codes.includes}});
      }
      else {
        // Excludes codes
        var excludesCodes = [];
        if (!csSettings.getByPath('plugins.es.notifications.txSent', false)) {
          excludesCodes.push('TX_SENT');
        }
        if (!csSettings.getByPath('plugins.es.notifications.txReceived', true)) {
          excludesCodes.push('TX_RECEIVED');
        }
        if (!csSettings.getByPath('plugins.es.notifications.certSent', false)) {
          excludesCodes.push('CERT_SENT');
        }
        if (!csSettings.getByPath('plugins.es.notifications.certReceived', true)) {
          excludesCodes.push('CERT_RECEIVED');
        }
        if (options.codes.excludes) {
          _.forEach(options.codes.excludes, function(code) {
            excludesCodes.push(code);
          });
        }
        if (excludesCodes.length) {
          query.bool.must_not = {terms: { code: excludesCodes}};
        }
      }

      // Filter on time
      if (options.readTime) {
        query.bool.must.push({range: {time: {gt: options.readTime}}});
      }
      return query;
    }

    // Load unread notifications count
    function loadUnreadNotificationsCount(pubkey, options) {
      var request = {
        query: createFilterQuery(pubkey, options)
      };
      // Filter unread only
      request.query.bool.must.push({missing: { field : "read_signature" }});
      return that.raw.postCount(request)
        .then(function(res) {
          return res.count;
        });
    }

    // Load user notifications
    function loadNotifications(pubkey, options) {
      options = options || {};
      options.from = options.from || 0;
      options.size = options.size || defaultLoadSize;
      var request = {
        query: createFilterQuery(pubkey, options),
        sort : [
          { "time" : {"order" : "desc"}}
        ],
        from: options.from,
        size: options.size,
        _source: fields.commons
      };

      return that.raw.postSearch(request)
        .then(function(res) {
          if (!res.hits || !res.hits.total) return [];
          var notifications = res.hits.hits.reduce(function(res, hit) {
            var item = new Notification(hit._source, markNotificationAsRead);
            item.id = hit._id;
            return res.concat(item);
          }, []);

          return esUser.profile.fillAvatars(notifications);
        });
    }

    function onNewNotification(event, data) {
      data = data || (csWallet.isLogin() ? csWallet.data : undefined);
      if (!data) return;
      var notification = new Notification(event, markNotificationAsRead);
      return esUser.profile.fillAvatars([notification])
        .then(function() {
          var isMessage = _.contains(constants.MESSAGE_CODES, event.code);
          var isGroup = _.contains(constants.GROUP_CODES, event.code);
          notification.isMessage = isMessage;
          if (isMessage) {
            data.messages = data.messages || {};
            data.messages.unreadCount++;
          }
          else if (isGroup) {
            data.groups = data.groups || {};
            data.groups.unreadCount++;
          }
          else {
            data.notifications = data.notifications || {};
            data.notifications.unreadCount++;
          }
          api.data.raise.new(notification);
        });
    }

    // Mark a notification as read
    function markNotificationAsRead(notification) {
      if (notification.read) return; // avoid multi call
      notification.read = true;
      CryptoUtils.sign(notification.hash, csWallet.data.keypair)
        .then(function(signature){
          return that.raw.postReadById(signature, {id:notification.id});
        })
        .catch(function(err) {
          console.error('Error while trying to mark event as read:' + (err.message ? err.message : err));
        });
    }

    function onWalletReset(data) {
      data.notifications = data.notifications || {};
      data.notifications.unreadCount = null;
      // Stop listening notification
      that.raw.ws.getUserEvent().close();
    }

    function onWalletLogin(data, deferred) {
      deferred = deferred || $q.defer();
      if (!data || !data.pubkey || !data.keypair) {
        deferred.resolve();
        return deferred.promise;
      }

      console.debug('[ES] [notification] Loading count...');
      var now = new Date().getTime();

      // Load unread notifications count
      loadUnreadNotificationsCount(
          data.pubkey, {
            readTime: csSettings.data.wallet ? csSettings.data.wallet.notificationReadTime : 0,
            excludeCodes: ['MESSAGE_RECEIVED']
          })
        .then(function(unreadCount) {
          data.notifications = data.notifications || {};
          data.notifications.unreadCount = unreadCount;
          console.debug('[ES] [notification] Loaded count (' + unreadCount + ') in '+(new Date().getTime()-now)+'ms');
          deferred.resolve(data);
        })
        .catch(function(err){
          deferred.reject(err);
        })

        // Listen new events
        .then(function(){
          console.debug('[ES] [notification] Starting listen user event...');
          var userEventWs = that.raw.ws.getUserEvent();
          listeners.push(userEventWs.close);
          return userEventWs.on(
              function(event){
                $rootScope.$apply(function() {
                  onNewNotification(event);
                });
              },
              {pubkey: data.pubkey, locale: csSettings.data.locale.id}
            )
            .catch(function(err) {
              console.error('[ES] [notification] Unable to listen user event');

              // TODO : send a event to csHttp instead ?
              // And display such connectivity errors in UI
              UIUtils.alert.error('ACCOUNT.ERROR.WS_CONNECTION_FAILED');
            });
        });

      return deferred.promise;
    }

    function removeListeners() {
      _.forEach(listeners, function(remove){
        remove();
      });
      listeners = [];
    }

    function addListeners() {
      // Listen some events
      listeners = [
        csWallet.api.data.on.login($rootScope, onWalletLogin, this),
        csWallet.api.data.on.init($rootScope, onWalletReset, this),
        csWallet.api.data.on.reset($rootScope, onWalletReset, this)
      ];
    }

    function refreshState() {
      var enable = esHttp.alive;
      if (!enable && listeners && listeners.length > 0) {
        console.debug("[ES] [notification] Disable");
        removeListeners();
        if (csWallet.isLogin()) {
          onWalletReset(csWallet.data);
        }
      }
      else if (enable && (!listeners || listeners.length === 0)) {
        console.debug("[ES] [notification] Enable");
        addListeners();
        if (csWallet.isLogin()) {
          return onWalletLogin(csWallet.data);
        }
      }
    }

    // Register extension points
    api.registerEvent('data', 'new');

    // Default actions
    Device.ready().then(function() {
      esHttp.api.node.on.start($rootScope, refreshState, this);
      esHttp.api.node.on.stop($rootScope, refreshState, this);
      return refreshState();
    });

    return {
      load: loadNotifications,
      unreadCount: loadUnreadNotificationsCount,
      api: api,
      websocket: {
        event: that.raw.ws.getUserEvent,
        change: that.raw.ws.getChanges
      },
      constants: constants
    };
  }

  return Factory();
})
;
