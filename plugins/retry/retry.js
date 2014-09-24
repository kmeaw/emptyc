// vim: ai:ts=2:sw=2:et:syntax=javascript
(function() {
  "use strict";
  var Q = require("q");

  module.exports.init = function retry_init(emptyc) {
    var failed = [];
    var cmd = null;

    emptyc.ev.on("failed", function(f) { failed = f; });
    emptyc.ev.on("run", function(sid, c) { failed = []; cmd = c; });

    emptyc.commands.retry = function(args) {
      if (!args && !cmd) return Q.reject("retry <cmd>");
      if (failed.length === 0) return Q.resolve();
      return emptyc.commands.run.apply(emptyc, [failed.join(',') + " " + (args || cmd)]);
    };
  };
}());
