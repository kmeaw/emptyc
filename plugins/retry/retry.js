// vim: ai:ts=2:sw=2:et:syntax=javascript
(function() {
  "use strict";
  var Q = require("q");

  module.exports.init = function retry_init(emptyc) {
    var failed = [];

    emptyc.ev.on("failed", function(f) { failed = f; });
    emptyc.ev.on("run", function(f) { failed = []; });

    emptyc.commands.retry = function(args) {
      if (!args) return Q.reject("retry <cmd>");
      if (failed.length === 0) return Q.resolve();
      return emptyc.commands.run.apply(emptyc, [failed.join(',') + " " + args]);
    };
  };
}());
