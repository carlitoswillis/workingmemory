"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// A small, safe markdown renderer shared across the app: card details (CardPanel),
// past details (SnapshotCardPanel), and — later — the AI weekly-review output. Uses
// react-markdown, which does NOT render raw HTML and strips dangerous URL protocols
// by default, so board content stays XSS-safe. GFM adds task lists / tables / str<s>.
// Styling lives in the `.md-body` block in globals.css (no typography plugin needed).
//
// Links open in a new tab (board content often points elsewhere). Task-list
// checkboxes are display-only for now — editing happens in the raw textarea.
export default function Markdown({ source }: { source: string }) {
  return (
    <div className="md-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ node, ...props }) => (
            <a {...props} target="_blank" rel="noopener noreferrer" />
          ),
        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}
