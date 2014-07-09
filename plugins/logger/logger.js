// vim: ai:ts=2:sw=2:et:syntax=javascript
(function() {
  "use strict";

  var NodeCache = require("node-cache");
  var colors = require("colors");
  var Q = require("q");

  module.exports.cache = new NodeCache({stdTTL: 14400, checkperiod: 120});

  var reset = true;

  var handlers = {
    output: function(data, key, type) {
      if (!key)
        return;
      if (reset)
      {
        module.exports.cache.flushAll();
        reset = false;
      }
      if (!type)
      {
        var buffer = module.exports.cache.get(key)[key] || "";
        buffer = buffer + (data.trim() + "\n");
        module.exports.cache.set(key, buffer);
      }
      else if (type == "stderr")
      {
        var buffer = module.exports.cache.get(key)[key] || "";
        buffer = buffer + (colors.red(data.trim()) + "\n");
        module.exports.cache.set(key, buffer);
      }
    },

    idle: function(idle) {
      if (idle)
        reset = true;
    }
  };

  module.exports.init = function logger_init(emptyc) {
    emptyc.ev.on("output", handlers.output);
    emptyc.ev.on("idle", handlers.idle);

    emptyc.commands.show = function(car) {
      var self = this;
      var cell = self.argshift(car);
      if (!car || !cell.car)
        return Q.reject("show <hosts>");
      return this.resolve([cell.car]).then(function(keys) {
        self.ev.removeListener("output", handlers.output);
        return keys;
      }).then(function(keys) {
        keys.forEach(function(k) {
          var value = module.exports.cache.get(k)[k];
          if (!value) return;
          self.ev.emit("info", "== " + k + " ==");
          self.ev.emit("info", value);
        });
        return Q.resolve();
      }).fin(function() {
        self.ev.on("output", handlers.output);
      });
    };
  };
}());
