// vim: ai:ts=2:sw=2:et:syntax=javascript
(function() {
  "use strict";
  var spawn = require('child_process').spawn;
  var Q = require('q');
  var ipmitool = "ipmitool";
  var fs = require('fs');
  var util = require('util');

  if (fs.existsSync("/usr/sbin/ipmitool"))
    ipmitool = "/usr/sbin/ipmitool";

  module.exports.init = function ipmi_init(emptyc) {
    emptyc.commands.ipmi = function(car) {
      /* help: <hosts> <command>: run ipmitool command for hosts */
      var cell;
      if (!car)
        return Q.reject("ipmi hosts command");
      cell = emptyc.argshift(car);
      var args = cell.cdr.split(/\s+/);
      if (emptyc.config("ipmi.extra"))
        args = emptyc.config("ipmi.extra").split(/\s+/).concat(args);
      var exits = {};
      var t = Date.now();
      return emptyc.resolve(cell.car.split(',')).then(function(hosts) {
        if (process.stdin.setRawMode)
        {
          process.stdin.setRawMode(false);
          process.stdin.pause();
        }
        var funcs = [];
        var progress_done = 0, progress_total = hosts.length;
        var running = 0;
        hosts.forEach(function(h) {
          funcs.push(function() {
            running++;
            var orig_h = h;
            if (emptyc.config("ipmi.prefix"))
              h = emptyc.config("ipmi.prefix") + h;
            if (emptyc.config("ipmi.suffix"))
              h = h + emptyc.config("ipmi.suffix");
            var client = spawn(ipmitool, [ "-H", h ].concat(args), emptyc.config("parallel") ? { stdio: "ignore" } : { stdio: "inherit" });
            if (!emptyc.config("parallel"))
              process.stdout.write(orig_h + ": ");
            var inthandler = function() {
              client.kill('SIGINT');
            };
            var deferred = Q.defer();
            if (!emptyc.config("parallel"))
              process.once('SIGINT', inthandler);
            client.on('close', function(code) {
              if (!emptyc.config("parallel"))
                process.removeListener('SIGINT', inthandler);
              exits[orig_h] = code;
              if (code !== 0)
                emptyc.ev.emit("info", "ipmitool exited with code " + code);
              emptyc.ev.emit("exit", orig_h, code);
              emptyc.ev.emit("progress", ++progress_done, progress_total);
              deferred.resolve();
            });
            if (emptyc.config("parallel"))
            {
              running--;
              var deferrends = [deferred.promise];
              if (running < 50)
              {
                var func = funcs.shift();
                if (func)
                  deferrends.push(func());
              }
              return Q.allSettled(deferrends);
            }
            else
              return deferred.promise;
          });
        });
        if (emptyc.config("parallel"))
          return funcs.shift()();
        else
          return funcs.reduce(Q.when, Q.resolve());
      }).fin(function() {
        process.stdin.resume();
        var failed = Object.keys(exits).filter(function(k){return exits[k] !== 0;});
        emptyc.ev.emit("info", util.format("IPMI run took %d ms, %d hosts have failed",
                Date.now() - t, failed.length));
        if (failed.length > 0)
        {
          emptyc.ev.emit("failed", failed);
          return Q.reject("Failed hosts: " + failed.join(','));
        }
      });
    };
  };
}());
