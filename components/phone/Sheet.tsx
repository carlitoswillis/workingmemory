// STUB — replaced by package B
//
// Package B owns this file: the Vaul wrapper (`Sheet`) and the host that reads
// usePhoneUI() and renders the right sheet for the current intent (`PhoneSheetHost`).
// Package A only needs the host to exist so the shell compiles and renders; the real
// one arrives with B's first commit and this file is taken wholesale from that side
// of the merge.
"use client";

export function PhoneSheetHost() {
  return null;
}

export default PhoneSheetHost;
