// vim: ai:ts=2:sw=2:et:syntax=javascript
(function() {
  "use strict";
  var child_process = require('child_process');
  var spawnAsync = require('child_process').spawn;
  var Q = require('q');
  var net = require('net');
  module.exports.init = function local_init(emptyc) {
    emptyc.spawn = function(deferred, argv0, argv) {
      process.stdin.setRawMode(false);
      process.once('SIGINT', () => {})
      var status = child_process.spawnSync(argv0, argv, {stdio:"inherit"});
      if (status.error)
        deferred.reject(argv0 + " has failed: " + status.error.toString());
      else if (status.status !== 0)
        deferred.reject(argv0 + " exited with code " + status.status);
      else if (status.signal)
        deferred.reject(argv0 + " has been killed with " + status.signal);
      else
        deferred.resolve();
      return deferred.promise;
    };

    emptyc.commands.ssh = function(car) {
      /* help: <host>: run interactive ssh to <host> */
      return emptyc.spawn(Q.defer(), "ssh", [
          "-oStrictHostKeyChecking=no", "-oUserKnownHostsFile=/dev/null",
          "-l", this.config.user,
          car
        ]);
    };

    emptyc.commands.ping = function(car) {
      /* help: <hosts> [<port>]: check hosts availability over ICMP or TCP */
      var self = this;
      var cell = self.argshift(car);
      var children = [];
      if (!car || !cell.car) return Q.reject("ping <hosts> [port]");
      return this.resolve([cell.car]).then(function(keys) {
        if (cell.cdr)
        {
          keys.forEach(function(k) {
            var host = k;
            var deferred = Q.defer();
            var client = net.connect({host: k, port: parseInt(cell.cdr)}, function(){
              client.destroy();
              deferred.resolve();
            });
            setTimeout(function() {
              client.destroy();
              deferred.reject(host);
            }, 2000);
            client.on('error', function(code) {
              client.destroy();
              deferred.reject(host);
            });
            children.push(deferred.promise)
          });
        }
        else if (keys.length == 1)
          children.push(emptyc.spawn(Q.defer(), "ping", [car]));
        else
        {
          keys.forEach(function(k) {
            var host = k;
            var deferred = Q.defer();
            var client = spawnAsync("ping", [ "-c1", "-n", "-q", k ]);
            client.on('exit', function(code) {
              if (code !== 0) deferred.reject(host);
                         else deferred.resolve();
            });
            children.push(deferred.promise)
          });
        }
      }).then(function() {
        return Q.allSettled(children).then(function(results) {
          var failed = results.filter(function(r) {return r.state !== "fulfilled";})
                              .map(function(r) {return r.reason;});
          if (failed.length == 0)
          {
            self.ev.emit("info", "OK");
            return Q.resolve();
          }
          else return Q.reject("Failed hosts: " + failed.join(','));
        });
      });
    };

    emptyc.commands.local = function(car) {
      /* help: <cmd>: run cmd on local system */
      if (!car) return Q.reject("local <cmd>");
      return emptyc.spawn(Q.defer(), "sh", ["-c", car]);
    };
  };
}());
