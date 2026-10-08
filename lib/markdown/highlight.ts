import { createElement, Fragment, type ReactNode } from "react";
import { createLowlight } from "lowlight";
import type { LanguageFn } from "highlight.js";
import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import go from "highlight.js/lib/languages/go";
import ini from "highlight.js/lib/languages/ini";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import kotlin from "highlight.js/lib/languages/kotlin";
import markdown from "highlight.js/lib/languages/markdown";
import php from "highlight.js/lib/languages/php";
import python from "highlight.js/lib/languages/python";
import ruby from "highlight.js/lib/languages/ruby";
import rust from "highlight.js/lib/languages/rust";
import shell from "highlight.js/lib/languages/shell";
import sql from "highlight.js/lib/languages/sql";
import swift from "highlight.js/lib/languages/swift";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";

// Loaded on demand by the code block (dynamic import), so the grammars stay out of the initial bundle.
// Output is a hast tree turned into React elements: model-written code is never injected as HTML.

const SHELL_CONTROL = "if|then|else|elif|fi|for|while|until|in|do|done|case|esac|function|select|time";

// highlight.js only colors shell built-ins, so `python --version` would stay plain. Also mark the command
// at the start of a line or after | ; & ( and flags such as --version.
const bashWithCommands: LanguageFn = (hljs) => {
  const grammar = bash(hljs);
  return {
    ...grammar,
    contains: [
      ...(grammar.contains ?? []),
      { scope: "built_in", match: new RegExp(`(?<=^[ \\t]*|[|;&(][ \\t]*)(?!(?:${SHELL_CONTROL})\\b)[A-Za-z_][\\w.+-]*(?=[ \\t]|$)`) },
      { scope: "attr", match: /(?<=\s)--?[A-Za-z][\w-]*/ },
    ],
  };
};

const lowlight = createLowlight({
  bash: bashWithCommands, c, cpp, csharp, css, diff, dockerfile, go, ini, java, json, kotlin,
  markdown, php, python, ruby, rust, shell, sql, swift, typescript, xml, yaml,
  // After typescript, which also claims the js aliases.
  javascript,
});
lowlight.registerAlias({ bash: ["shell-script", "terminal"], dockerfile: ["docker"], ini: ["toml"], xml: ["html", "svg"] });

type HastNode = { type: string; value?: string; properties?: { className?: unknown }; children?: HastNode[] };

function toReact(nodes: readonly HastNode[]): ReactNode[] {
  return nodes.map((node) => {
    if (node.type === "text") return node.value ?? "";
    if (node.type !== "element") return null;
    const className = node.properties?.className;
    return createElement("span", { className: Array.isArray(className) ? className.join(" ") : undefined }, ...toReact(node.children ?? []));
  });
}

/** Syntax-highlighted code for a known language, or null to render the text as-is. */
export function highlightCode(code: string, language: string | undefined): ReactNode | null {
  const name = language?.toLowerCase();
  if (!name || !lowlight.registered(name)) return null;
  try {
    const tree = lowlight.highlight(name, code) as unknown as { children: HastNode[] };
    return createElement(Fragment, null, ...toReact(tree.children));
  } catch {
    return null;
  }
}
