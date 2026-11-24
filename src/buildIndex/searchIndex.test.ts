import assert from "assert";
import { flattenLeaves, renderSearchIndexJs } from "./searchIndex";

// flattenLeaves titles each leaf by its full section path and keeps the href
const tree = [
  {
    label: "A",
    children: [
      { label: "B", href: "A/B.pdf" },
      { label: "C", href: "A/C.svg" },
    ],
  },
];
assert.deepEqual(flattenLeaves(tree), [
  { href: "A/B.pdf", title: "A › B" },
  { href: "A/C.svg", title: "A › C" },
]);

// renderSearchIndexJs embeds entries as window.__SEARCH__ and is <script>-safe
const js = renderSearchIndexJs([{ href: "A/B.pdf", title: "A", text: "hello </script> world" }]);
assert.match(js, /window\.__SEARCH__\s*=/);
assert.ok(!js.includes("</script>")); // "<" escaped to <

console.log("OK");
