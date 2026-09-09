import { createLucideIcon } from "lucide-react";

// Glyphs for concepts the lucide set lacks, sourced from Tabler Icons (MIT) -
// which share lucide's 24x24 / 2px-stroke line language, so they blend with the
// rest of the beta chrome. Minted through createLucideIcon so each behaves
// exactly like a LucideIcon (size / strokeWidth / className props, currentColor
// stroke, round caps). Path data is verbatim from Tabler's outline icons.

// Tabler "sandbox" - a sand box with a shovel poking out: the literal play
// sandbox, vs lucide's chemistry beaker. Used for the Sandbox (combat lab) nav.
export const SandboxIcon = createLucideIcon("Sandbox", [
  [
    "path",
    {
      d: "M19.953 8.017l1.047 6.983v2a3 3 0 0 1 -3 3h-12a3 3 0 0 1 -3 -3v-2l1.245 -8.297a2 2 0 0 1 1.977 -1.703h3.778",
      key: "body",
    },
  ],
  ["path", { d: "M3 15h18", key: "rim" }],
  ["path", { d: "M13 3l5.5 1.5", key: "grip" }],
  ["path", { d: "M15.75 3.75l-2 7", key: "shaft" }],
  ["path", { d: "M7 10.5c1.667 -.667 3.333 -.667 5 0c1.667 .667 3.333 .667 5 0", key: "sand" }],
]);

// Tabler "books" - a pair of bound books with spines + a tilted volume: a
// fuller, more detailed "collection" than lucide's thin shelf of spines. Used
// for the Custom page's Library menu.
export const BooksStackIcon = createLucideIcon("BooksStack", [
  ["path", { d: "M5 5a1 1 0 0 1 1 -1h2a1 1 0 0 1 1 1v14a1 1 0 0 1 -1 1h-2a1 1 0 0 1 -1 -1l0 -14", key: "b1" }],
  ["path", { d: "M9 5a1 1 0 0 1 1 -1h2a1 1 0 0 1 1 1v14a1 1 0 0 1 -1 1h-2a1 1 0 0 1 -1 -1l0 -14", key: "b2" }],
  ["path", { d: "M5 8h4", key: "s1" }],
  ["path", { d: "M9 16h4", key: "s2" }],
  [
    "path",
    {
      d: "M13.803 4.56l2.184 -.53c.562 -.135 1.133 .19 1.282 .732l3.695 13.418a1.02 1.02 0 0 1 -.634 1.219l-.133 .041l-2.184 .53c-.562 .135 -1.133 -.19 -1.282 -.732l-3.695 -13.418a1.02 1.02 0 0 1 .634 -1.219l.133 -.041",
      key: "b3",
    },
  ],
  ["path", { d: "M14 9l4 -1", key: "s3" }],
  ["path", { d: "M16 16l3.923 -.98", key: "s4" }],
]);
