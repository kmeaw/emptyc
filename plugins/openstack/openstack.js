// vim: ai:ts=2:sw=2:et:syntax=javascript
(function() {
  "use strict";

  var Q = require('q');
  var http = require('http');
  var exec = require('child_process').exec;

  var os_resolver = function(value) {
    var components = value.split(',');
    return Q.all(components.map(function(c) {
      /* $os$sas$mail_stateless */
      if (c.indexOf('$os') === 0 && c.split('$').length == 4)
      {
        var deferred = Q.defer();
        var os_components = c.split('$');
        exec(['openstack', 'aggregate', 'show', 
            '-c', 'hosts',
            '--format', 'json',
            '--os-region', os_components[2],
            os_components[3]].join(" "), function(err, stdout, stderr) {
              if (err) return deferred.reject(err);
              if (stderr) return deferred.reject(stderr.strip());
              var os_data;
              try {
                os_data = JSON.parse(stdout);
                os_data = os_data.hosts;
                if (!os_data) return deferred.reject("No hosts in " + stdout);
              } catch(e) {
                return deferred.reject(e);
              }
              return deferred.resolve(os_data);
            });
        return deferred.promise;
      }
      else
        return Q.resolve(c);
    })).then(function(data) {
      return [].concat.apply([], data);
    });
  };

  module.exports.init = function(emptyc) {
    emptyc.resolvers.push(os_resolver.bind(emptyc));
  }
}());
