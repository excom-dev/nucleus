import {
  afterEach,
  describe,
  expect,
  fixture,
  it,
  vi,
  wait,
} from "@excom/heft-rig/profiles/default/config/test-utils";
import "../../index";

describe("super-img", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("captures the inner image element on connect", async () => {
    const el = fixture<HTMLSuperImgElement>(
      `<super-img><img /></super-img>`,
    );

    await wait(0);
    expect(el.imgElement).toBe(el.querySelector("img"));
  });
});
