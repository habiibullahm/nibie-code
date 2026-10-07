/**
 * Deep Research V1 eval fixtures — deterministic cases from the product acceptance set.
 * No live network; tests mock search/fetch/plan.
 */

export type DeepResearchEvalCase = {
  id: string;
  question: string;
  /** Expect planner timeSensitive true/false when using fallback or mocked plan. */
  expectTimeSensitive: boolean;
  /** Expect follow-up may be needed with thin evidence. */
  thinEvidenceFollowUp?: boolean;
  notes: string;
};

export const DEEP_RESEARCH_EVAL_CASES: DeepResearchEvalCase[] = [
  {
    id: "current-facts",
    question: "What is the current stable version of Node.js and when was it released?",
    expectTimeSensitive: true,
    notes: "Current facts need freshness-aware gathering.",
  },
  {
    id: "technical-compare",
    question: "Compare PostgreSQL and MySQL for JSON workloads: tradeoffs and when to pick each.",
    expectTimeSensitive: false,
    notes: "Technical compare — multi-source synthesis with tradeoffs.",
  },
  {
    id: "official-docs",
    question: "What does the official Next.js documentation say about the App Router caching model?",
    expectTimeSensitive: false,
    notes: "Prefer primary/official documentation.",
  },
  {
    id: "conflicting-sources",
    question: "What do recent reviews say about Model X pricing and benchmark scores?",
    expectTimeSensitive: true,
    notes: "Conflicting pricing/benchmark claims should be surfaced.",
  },
  {
    id: "timeless-concept",
    question: "Explain what a Bloom filter is and the main tradeoffs of using one.",
    expectTimeSensitive: false,
    notes: "Timeless concept — must not over-weight freshness.",
  },
  {
    id: "weak-evidence",
    question: "What is the exact market share of an obscure regional SaaS tool in 2026?",
    expectTimeSensitive: true,
    thinEvidenceFollowUp: true,
    notes: "Weak evidence / uncertainty — do not claim completed research.",
  },
];

export const MOCK_RESEARCH_PAGES = {
  nodeDocs: {
    url: "https://nodejs.org/en/about/previous-releases",
    title: "Node.js Releases",
    domain: "nodejs.org",
    body: "<html><body><h1>Node.js</h1><p>Current stable release is documented on the official site with release dates.</p></body></html>",
  },
  postgresDocs: {
    url: "https://www.postgresql.org/docs/current/datatype-json.html",
    title: "PostgreSQL JSON Types",
    domain: "postgresql.org",
    body: "<html><body><p>PostgreSQL provides json and jsonb types with indexing tradeoffs for JSON workloads.</p></body></html>",
  },
  mysqlDocs: {
    url: "https://dev.mysql.com/doc/refman/8.4/en/json.html",
    title: "MySQL JSON",
    domain: "dev.mysql.com",
    body: "<html><body><p>MySQL JSON stores documents; secondary indexes differ from PostgreSQL jsonb.</p></body></html>",
  },
  pricingA: {
    url: "https://example-vendor.com/pricing",
    title: "Vendor pricing",
    domain: "example-vendor.com",
    body: "<html><body><p>Pro plan costs $20 per month. Benchmark score 82.</p></body></html>",
  },
  pricingB: {
    url: "https://review-site.example/model-x",
    title: "Model X review",
    domain: "review-site.example",
    body: "<html><body><p>Pro plan listed at $29 per month. Independent benchmark score 71.</p></body></html>",
  },
  bloomFilter: {
    url: "https://en.wikipedia.org/wiki/Bloom_filter",
    title: "Bloom filter",
    domain: "en.wikipedia.org",
    body: "<html><body><p>A Bloom filter is a probabilistic data structure for set membership with false positives and no false negatives under normal use.</p></body></html>",
  },
} as const;
