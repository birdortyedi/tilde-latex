// Loaded into the TeX engine's worker before a compile when "Show all errors"
// is off: LaTeX stops at the first error again, as the engine does by itself
// (see keep-going.js).
self.tildeKeepGoing = false;
