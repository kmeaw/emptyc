// vim: ai:ts=2:sw=2:et:syntax=javascript
(function() {
  "use strict";
  var spawn = require('child_process').spawn;
  var Q = require('q');
  var ipmitool = "ipmitool";
  var fs = require('fs');

  if (fs.existsSync("/usr/sbin/ipmitool"))
    ipmitool = "/usr/sbin/ipmitool";

  module.exports.init = function ipmi_init(emptyc) {
    emptyc.commands.ipmi = function(car) {
      var cell;
      if (!car)
        return Q.reject("ipmi hosts command");
      cell = emptyc.argshift(car);
      var args = cell.cdr.split(/\s+/);
      if (emptyc.config("ipmi.extra"))
        args = emptyc.config("ipmi.extra").split(/\s+/).concat(args);
      return emptyc.resolve(cell.car.split(',')).then(function(hosts) {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        var funcs = [];
        hosts.forEach(function(h) {
          funcs.push(function() {
            if (emptyc.config("ipmi.prefix"))
              h = emptyc.config("ipmi.prefix") + h;
            if (emptyc.config("ipmi.suffix"))
              h = h + emptyc.config("ipmi.suffix");
            var client = spawn(ipmitool, [ "-H", h ].concat(args), { stdio: "inherit" });
            process.stdout.write(h + ": ");
            var inthandler = function() {
              client.kill('SIGINT');
            };
            var deferred = Q.defer();
            process.on('SIGINT', inthandler);
            client.on('close', function(code) {
              process.removeListener('SIGINT', inthandler);
              if (code !== 0)
                console.log("ipmitool exited with code %d", code);
              deferred.resolve();
            });
            return deferred.promise;
          });
        });
        return funcs.reduce(Q.when, Q.resolve());
      }).fin(function() {
          process.stdin.resume();
      });
    };
  };
}());
