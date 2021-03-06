angular.module('cesium.es.wot.controllers', ['cesium.es.services'])

  .config(function(PluginServiceProvider, csConfig) {
    'ngInject';

    var enable = csConfig.plugins && csConfig.plugins.es;
    if (enable) {
      PluginServiceProvider

        .extendStates(['app.wot_identity', 'app.wot_identity_uid'], {
          points: {
            'general': {
              templateUrl: "plugins/es/templates/wot/view_identity_extend.html",
              controller: 'ESWotIdentityViewCtrl'
            },
            'buttons': {
              templateUrl: "plugins/es/templates/wot/view_identity_extend.html",
              controller: 'ESWotIdentityViewCtrl'
            }
          }
        })

        .extendStates(['app.wot_cert', 'app.wot_cert_lg'], {
          points: {
            'nav-buttons': {
              templateUrl: "plugins/es/templates/wot/view_certifications_extend.html",
              controller: 'ESWotIdentityViewCtrl'
            },
            'buttons': {
              templateUrl: "plugins/es/templates/wot/view_certifications_extend.html",
              controller: 'ESWotIdentityViewCtrl'
            }
          }
        })
      ;
    }

  })

 .controller('ESWotIdentityViewCtrl', ESWotIdentityViewController)

;

function ESWotIdentityViewController($scope, $timeout, $ionicPopover, Modals, csSettings, PluginService, esModals, UIUtils) {
  'ngInject';

  $scope.extensionPoint = PluginService.extensions.points.current.get();

  $scope.updateView = function() {
    $scope.enable = csSettings.data.plugins && csSettings.data.plugins.es ?
      csSettings.data.plugins.es.enable :
      !!csSettings.data.plugins.host;
  };

  csSettings.api.data.on.changed($scope, function() {
    $scope.updateView();
  });

  $scope.updateView();

  /* -- modals -- */

  $scope.showNewMessageModal = function(confirm) {
    return $scope.loadWallet({minData: true})

      .then(function() {
        UIUtils.loading.hide();

        // Ask confirmation, if user has no Cesium+ profil
        if (!confirm && !$scope.formData.profile) {
          return UIUtils.alert.confirm('MESSAGE.CONFIRM.USER_HAS_NO_PROFILE')
            .then(function (confirm) {
              // Recursive call (with confirm flag)
              if (confirm) return true;
            });
        }
        return true;
      })
      // Open modal
      .then(function(confirm) {
        if (!confirm) return false;

        return esModals.showMessageCompose({
          destPub: $scope.formData.pubkey,
          destUid: $scope.formData.name||$scope.formData.uid
        });
      });
  };

  $scope.showSuggestCertificationModal = function() {

    $scope.hideCertificationActionsPopover();

    return $scope.loadWallet({minData: true})

      .then(function() {
        UIUtils.loading.hide();

        Modals.showWotLookup({
          allowMultiple: true,
          enableFilter: true,
          title: 'WOT.SUGGEST_CERTIFICATIONS_MODAL.TITLE',
          help: 'WOT.SUGGEST_CERTIFICATIONS_MODAL.HELP',
          okText: 'COMMON.BTN_SEND',
          okType: 'button-positive'
        })
          .then(function(identities) {
            if (!identities || !identities.length) return;
            console.debug('Will send suggestions', identities);
            return UIUtils.alert.notImplemented();
            /*esUser.send({
              destPub: $scope.formData.pubkey,
              destUid: $scope.formData.name||$scope.formData.uid,
              identities
            });*/
          });


      });
  };

  /* -- Popover -- */

  $scope.showCertificationActionsPopover = function(event) {
    if (!$scope.certificationActionsPopover) {
      $ionicPopover.fromTemplateUrl('plugins/es/templates/wot/popover_certification_actions.html', {
        scope: $scope
      }).then(function(popover) {
        $scope.certificationActionsPopover = popover;
        //Cleanup the popover when we're done with it!
        $scope.$on('$destroy', function() {
          $scope.certificationActionsPopover.remove();
        });
        $scope.certificationActionsPopover.show(event);
      });
    }
    else {
      $scope.certificationActionsPopover.show(event);
    }
  };

  $scope.hideCertificationActionsPopover = function() {
    if ($scope.certificationActionsPopover) {
      $scope.certificationActionsPopover.hide();
    }
  };


  // TODO : for DEV only
  /*$timeout(function() {
    if ($scope.extensionPoint != 'buttons') return;
    $scope.showSuggestCertificationModal();
  }, 1000);*/
}

