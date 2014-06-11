// vim: ai:ts=2:sw=2:et:syntax=javascript
(function() {
  "use strict";
  var spawn = require('child_process').spawn;
  var Q = require('q');
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
      return deferred.promise;
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
