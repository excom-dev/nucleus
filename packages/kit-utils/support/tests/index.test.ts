import * as index from "../../index";
import {
  describe,
  expect,
  it,
} from "@excom/nucleus-test";

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
    expect(index.fetchRecord).toBeTypeOf("function");
    expect(index.templateIdentity).toBeTypeOf("function");
    expect(index.HYDRATION_ISLAND_ID).toBe("nucleus-hydration");
  });
});
