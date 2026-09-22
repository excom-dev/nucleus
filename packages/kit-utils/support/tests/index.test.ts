import * as index from "../../index";
import {
  describe,
  expect,
  it,
} from "@excom/heft-rig/profiles/default/config/test-utils";

describe("index", () => {
  it("re-exports the helper modules", () => {
    expect(index.BatchManager).toBeTypeOf("function");
    expect(index.deepMerge).toBeTypeOf("function");
    expect(index.Converter).toBeTypeOf("object");
    expect(index.TokenList).toBeTypeOf("function");
    expect(index.resolveTemplateContent).toBeTypeOf("function");
    expect(index.formToJson).toBeTypeOf("function");
    expect(index.observeProperty).toBeTypeOf("function");
    expect(index.QueueManager).toBeTypeOf("function");
    expect(index.mergeSearchParamsIntoUrl).toBeTypeOf("function");
  });
});
