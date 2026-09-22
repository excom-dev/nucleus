import * as utils from "../../url";
import { describe, expect, it } from "@excom/heft-rig/node_modules/vitest";

describe("url", () => {
  it("mergeSearchParamsIntoUrl: merges search params into URL", () => {
    const url = "http://example.com/api";
    const params = new URLSearchParams({ foo: "bar", baz: "qux" });
    const result = utils.mergeSearchParamsIntoUrl(url, params);
    expect(result).to.equal("http://example.com/api?foo=bar&baz=qux");
  });

  it("mergeSearchParamsIntoUrl: handles existing search params in URL", () => {
    const url = "http://example.com/api?existing=param";
    const params = new URLSearchParams({ foo: "bar", baz: "qux" });
    const result = utils.mergeSearchParamsIntoUrl(url, params);
    expect(result).to.equal(
      "http://example.com/api?existing=param&foo=bar&baz=qux"
    );
  });

  it("mergeSearchParamsIntoUrl: returns the same URL if no params are provided", () => {
    const url = "http://example.com/api";
    const result = utils.mergeSearchParamsIntoUrl(url, new URLSearchParams());
    expect(result).to.equal(url);
  });
  it("jsonToSearchParams: converts JSON to URLSearchParams", () => {
    const json = { foo: "bar", baz: "qux" };
    const result = utils.jsonToSearchParams(json);
    expect(result instanceof URLSearchParams).toBe(true);
    expect(result.get("foo")).toBe("bar");
    expect(result.get("baz")).toBe("qux");
  });

  it("jsonToSearchParams: returns empty URLSearchParams for empty object", () => {
    const json = {};
    const result = utils.jsonToSearchParams(json);
    expect(result instanceof URLSearchParams).toBe(true);
    expect(result.toString()).toBe("");
  });

  it("jsonToSearchParams: returns empty param for empty value", () => {
    const json = { foo: "", baz: "qux" };
    const result = utils.jsonToSearchParams(json).toString();
    expect(result).toBe("foo=&baz=qux");
  });

  it("jsonToSearchParams: stringifies and encodes nested objects", () => {
    const json = { foo: { bar: "baz" }, qux: "quux", arrayKey: [1, 2, 3] };
    const result = utils.jsonToSearchParams(json).toString();
    expect(result).toBe(
      "foo=%7B%22bar%22%3A%22baz%22%7D&qux=quux&arrayKey=%5B1%2C2%2C3%5D"
    );
  });

  it("jsonToSearchParams: stringifies and encodes in a way that can be parsed back", () => {
    const json = {
      foo: "bar",
      baz: "qux",
      nested: { a: 1, b: 2 },
      arrayKey: [1, 2, 3],
    };
    const params = utils.jsonToSearchParams(json);
    const result = new URLSearchParams(params.toString());
    expect(result.get("foo")).toBe("bar");
    expect(result.get("baz")).toBe("qux");
    expect(result.get("nested")).toBe('{"a":1,"b":2}');

    const url = "http://example.com/api?" + params.toString();
    const parsedUrl = new URL(url);
    expect(parsedUrl.searchParams.get("foo")).toBe("bar");
    expect(parsedUrl.searchParams.get("baz")).toBe("qux");
    expect(parsedUrl.searchParams.get("nested")).toBe('{"a":1,"b":2}');
    expect(parsedUrl.searchParams.get("arrayKey")).toBe("[1,2,3]");
  });

  it("jsonToSearchParams: null and undefined become empty values", () => {
    const result = utils.jsonToSearchParams({
      a: null,
      b: undefined,
      c: 0,
      d: false,
    });
    expect(result.toString()).toBe("a=&b=&c=0&d=false");
  });

  it("mergeSearchParams: overrides existing keys and appends new ones", () => {
    const base = new URLSearchParams("a=1&b=2&b=3");
    const incoming = new URLSearchParams("b=9&c=4");
    const merged = utils.mergeSearchParams(base, incoming);
    expect(merged.toString()).toBe("a=1&b=9&c=4");
    // inputs are untouched
    expect(base.toString()).toBe("a=1&b=2&b=3");
    expect(incoming.toString()).toBe("b=9&c=4");
  });

  it("mergeSearchParamsIntoUrl: overrides an existing param in the URL", () => {
    const result = utils.mergeSearchParamsIntoUrl(
      "http://example.com/api?page=1&sort=asc",
      new URLSearchParams({ page: "2" })
    );
    expect(result).toBe("http://example.com/api?page=2&sort=asc");
  });

  it("mergeSearchParamsIntoUrl: resolves relative URLs against the page origin", () => {
    const result = utils.mergeSearchParamsIntoUrl(
      "/api/items?x=1",
      new URLSearchParams({ y: "2" })
    );
    expect(result).toBe(`${window.location.origin}/api/items?x=1&y=2`);
  });
});
