// Loaded into the TeX engine's worker before a compile, when the user chose
// "Show all errors" (see main.ts). LaTeX then goes on after an error instead
// of stopping at the first: the engine's own runs leave out --halt-on-error,
// and a run that still wrote a PDF counts as done, so the remaining runs (and
// the bibliography) follow. The errors stay in the log, where Tilde lists them.
// The engine's files are not changed; this wraps one of its functions.
(function () {
  const pipeline = typeof BusytexPipeline !== 'undefined' ? BusytexPipeline.prototype : null;
  if (pipeline && !pipeline.tildeWrapped) {
    const run = pipeline._run_cmd;
    pipeline._run_cmd = function (Module, FS, cmd, ...rest) {
      if (!self.tildeKeepGoing) return run.call(this, Module, FS, cmd, ...rest);
      const result = run.call(this, Module, FS, cmd.filter((arg) => arg !== '--halt-on-error'), ...rest);
      const isLatex = !/^(bibtex|makeindex|xdvipdfmx)/.test(cmd[0]);
      return isLatex && result.exit_code !== 0 && /Output written on /.test(result.log || '') ? { ...result, exit_code: 0 } : result;
    };
    pipeline.tildeWrapped = true;
  }
  self.tildeKeepGoing = true;
})();
