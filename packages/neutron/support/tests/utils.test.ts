import * as utils from "../../src/utils";
import { describe, expect, it } from "@excom/heft-rig/node_modules/vitest";

describe("utils", () => {
  it("isBuiltInElement", () => {
    const el = document.createElement("div");
    expect(utils.isBuiltInElement(el)).to.be.true;
    const el2 = document.createElement("c-e");
    expect(utils.isBuiltInElement(el2)).to.be.false;
  });

  it("effector", () => {
    const div = document.createElement("div");
    const mutateDiv = utils
      .effector((_, param) => ({
        textContent: "Hello World",
        style: { color: "red" },
        returns: "YES",
        title: param,
      }))
      .bind(div);
    expect(mutateDiv("NEW_TITLE")).to.equal("YES");
    expect(div.textContent).to.equal("Hello World");
    expect(div.style.color).to.equal("red");
    expect(div.title).to.equal("NEW_TITLE");

    const mutateDiv2 = utils
      .effector(() => [
        { autofocus: true },
        {
          textContent: "Hello!",
          style: { color: "blue" },
          returns: "PERHAPS",
        },
        {
          id: "my-id",
        },
        { id: "other-id" },
        {
          title: "my-title",
        },
      ])
      .bind(div);
    expect(mutateDiv2()).to.equal("PERHAPS");
    expect(div.autofocus).to.be.true;
    expect(div.textContent).to.equal("Hello!");
    expect(div.style.color).to.equal("blue");
    expect(div.id).to.equal("other-id");
    expect(div.title).to.equal("my-title");
    const mutateDiv3 = utils
      .effector(() => [
        {
          textContent: "World!",
          style: { color: "green" },
          returns: "NO",
        },
        { autofocus: false },
        {
          title: "z-title",
        },
        { id: "y-id" },
        {
          id: "x-id",
        },
      ])
      .bind(div);

    expect(mutateDiv3()).to.equal("NO");
    expect(div.autofocus).to.be.false;
    expect(div.textContent).to.equal("World!");
    expect(div.style.color).to.equal("green");
    expect(div.id).to.equal("x-id");
    expect(div.title).to.equal("z-title");
  });
});
