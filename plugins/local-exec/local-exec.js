// vim: ai:ts=2:sw=2:et:syntax=javascript
(function() {
  "use strict";
  var spawn = require('child_process').spawn;
  var Q = require('q');
  var net = require('net');
  module.exports.init = function local_init(emptyc) {
    emptyc.commands.ssh = function(car) {
      var deferred = Q.defer();
      process.stdin.setRawMode(false);
      process.stdin.pause();
      var client = spawn("ssh", [
          "-oStrictHostKeyChecking=no", "-oUserKnownHostsFile=/dev/null",
          "-l", this.config.user,
          car
        ], { stdio: "inherit" });
      var inthandler = function() {
        client.kill('SIGINT');
      };
      process.on('SIGINT', inthandler);
      client.on('close', function(code) {
        process.stdin.resume();
        process.removeListener('SIGINT', inthandler);
        if (code !== 0)
          deferred.reject("SSH exited with code " + code);
        else
          deferred.resolve();
      });
      return deferred.promise;
    };

    emptyc.commands.ping = function(car) {
      var cell = emptyc.argshift(car);
      var self = this;
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
            client.on('error', function(code) {
              client.destroy();
              deferred.reject(host);
            });
            children.push(deferred.promise)
          });
        }
        else if (keys.length == 1)
        {
          var deferred = Q.defer();
          process.stdin.setRawMode(false);
          process.stdin.pause();
          var client = spawn("ping", [
              car
            ], { stdio: "inherit" });
          var inthandler = function() {
            client.kill('SIGINT');
          };
          process.on('SIGINT', inthandler);
          client.on('close', function(code) {
            process.stdin.resume();
            process.removeListener('SIGINT', inthandler);
            if (code !== 0)
              deferred.reject("ping exited with code " + code);
            else
              deferred.resolve();
          });
          children.push(deferred.promise);
        }
        else
        {
          keys.forEach(function(k) {
            var host = k;
            var deferred = Q.defer();
            var client = spawn("ping", [ "-c1", "-n", "-q", k ]);
            client.on('close', function(code) {
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
      var deferred = Q.defer();
      process.stdin.setRawMode(false);
      process.stdin.pause();
      var client = spawn("sh", [
          "-c", car
        ], { stdio: "inherit" });
      var inthandler = function() {
        client.kill('SIGINT');
      };
      process.on('SIGINT', inthandler);
      client.on('close', function(code) {
        process.stdin.resume();
        process.removeListener('SIGINT', inthandler);
        if (code !== 0)
          deferred.reject("exited with code " + code);
        else
          deferred.resolve();
      });
      return deferred.promise;
    };
  };
}());
