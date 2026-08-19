import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeEntities } from "../lib/decode-entities.js";

test("decodes the named entities scraped HTML actually uses", () => {
  assert.equal(decodeEntities("Women&#x27;s Studies"), "Women's Studies");
  assert.equal(decodeEntities("Rock &amp; Roll"), "Rock & Roll");
  assert.equal(decodeEntities("&quot;quoted&quot;"), '"quoted"');
  assert.equal(decodeEntities("A &lt; B &gt; C"), "A < B > C");
  assert.equal(decodeEntities("O&apos;Brien"), "O'Brien");
});

test("decodes numeric entities, decimal and hex", () => {
  assert.equal(decodeEntities("&#39;"), "'");
  assert.equal(decodeEntities("&#x27;"), "'");
  assert.equal(decodeEntities("&#X27;"), "'");
});

test("leaves plain text and unrecognized entities alone", () => {
  assert.equal(decodeEntities("CS 3350"), "CS 3350");
  assert.equal(decodeEntities("&madeup;"), "&madeup;");
});

test("passes through empty/null input instead of throwing", () => {
  assert.equal(decodeEntities(""), "");
  assert.equal(decodeEntities(null), null);
  assert.equal(decodeEntities(undefined), undefined);
});
