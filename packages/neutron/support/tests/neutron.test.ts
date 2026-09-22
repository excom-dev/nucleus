import { Neutron } from "../../src/neutron";
import {
  afterAll,
  afterEach,
  describe,
  expect,
  it,
  Mock,
  beforeEach,
  vi,
} from "@excom/heft-rig/node_modules/vitest";
import {
  wait,
  waitForEvent,
} from "@excom/heft-rig/profiles/default/config/test-utils";
import { createElement, TokenList } from "@excom/kit-utils";

let serializeFn = (value: unknown) => value;
let deserializeFn = (value: unknown) => value;

const TestElement = Neutron({
  tag: "test-element",
  props: {
    myString: {
      type: String,
      serialize: (v) => serializeFn(v),
      deserialize: (v) => deserializeFn(v),
    },
    myNumber: {
      type: Number,
      serialize: (v) => serializeFn(v),
      deserialize: (v) => deserializeFn(v),
    },
    myBoolean: {
      type: Boolean,
      serialize: (v) => serializeFn(v),
      deserialize: (v) => deserializeFn(v),
    },
    myTokens: {
      type: TokenList,
      serialize: (v) => serializeFn(v),
      deserialize: (v) => deserializeFn(v),
    },
    myObject: {
      type: Object,
      serialize: (v) => serializeFn(v),
      deserialize: (v) => deserializeFn(v),
    },
    myArray: {
      type: Array,
      serialize: (v) => serializeFn(v),
      deserialize: (v) => deserializeFn(v),
    },
    pTag: {
      type: HTMLParagraphElement,
      serialize: (v) => serializeFn(v),
      deserialize: (v) => deserializeFn(v),
    },
    myPromise: {
      type: Promise,
      serialize: (v) => serializeFn(v),
      deserialize: (v) => deserializeFn(v),
    },
    provision: {
      type: Object,
      serialize: (v) => serializeFn(v),
      deserialize: (v) => deserializeFn(v),
    },
  },
})
  .defineMethods({
    myEffector: () => {
      return null;
    },
  })
  .onConstructed(vi.fn())
  .onConnected(vi.fn())
  .onDisconnected(vi.fn())
  .onAdopted(vi.fn())
  // string
  .onPropChanged("myString", vi.fn())
  .onPropSet("myString", vi.fn())
  .onPropUnset("myString", vi.fn())
  // number
  .onPropChanged("myNumber", vi.fn())
  .onPropSet("myNumber", vi.fn())
  .onPropUnset("myNumber", vi.fn())
  // boolean
  .onPropChanged("myBoolean", vi.fn())
  .onPropSet("myBoolean", vi.fn())
  .onPropUnset("myBoolean", vi.fn())
  // tokens
  .onPropChanged("myTokens", vi.fn())
  .onPropSet("myTokens", vi.fn())
  .onPropUnset("myTokens", vi.fn())
  // element
  .onPropChanged("pTag", vi.fn())
  .onPropSet("pTag", vi.fn())
  .onPropUnset("pTag", vi.fn())
  // promise
  .onPropChanged("myPromise", vi.fn())
  .onPropSet("myPromise", vi.fn())
  .onPropUnset("myPromise", vi.fn())
  .onPromiseResolved("myPromise", vi.fn())
  .onPromiseRejected("myPromise", vi.fn())
  // object
  .onPropChanged("myObject", vi.fn())
  .onPropSet("myObject", vi.fn())
  .onPropUnset("myObject", vi.fn())
  // array
  .onPropChanged("myArray", vi.fn())
  .onPropSet("myArray", vi.fn())
  .onPropUnset("myArray", vi.fn())
  // provision
  .onPropChanged("provision", vi.fn())
  .onPropSet("provision", vi.fn())
  .onPropUnset("provision", vi.fn())
  // event
  .onEvent("test-element-event", vi.fn())
  // default
  .onEventDefault("test-element-event-other", vi.fn())
  // broadcast
  .onBroadcast("test-broadcast", vi.fn());

TestElement.define();
declare global {
  type TTestElementElement = typeof TestElement.CustomElement;
  interface HTMLTestElementElement extends TTestElementElement {}
  interface Window {
    HTMLTestElementElement: HTMLTestElementElement;
  }
  interface HTMLElementTagNameMap {
    "test-element": HTMLTestElementElement;
  }
}

interface PropTestMatrix {
  property: {
    name: string;
    value: unknown;
  };
  attribute?: {
    name: string;
    value: unknown;
  };
  propIndex: number;
  propChangedExpect: number;
  propSetExpect: number;
  propUnsetExpect: number;
}

const testProp = (
  testElement: HTMLTestElementElement,
  {
    property,
    attribute,
    propIndex,
    propChangedExpect,
    propSetExpect,
    propUnsetExpect,
  }: PropTestMatrix,
) => {
  const { propChanged, propSet, propUnset } =
    testElement._n_.ctr.builtConfig.lifecycles;
  const oldValue = testElement[property.name];
  // write the prop
  const propertyTest = () => {
    testElement[property.name] = property.value;
    expect(testElement[property.name]).toStrictEqual(property.value);
    if (attribute) {
      expect(testElement.getAttribute(attribute.name)).toBe(
        serializeFn(attribute.value),
      );
    }
    expect(propChanged[propIndex][1]).toHaveBeenCalledTimes(propChangedExpect);
    expect(propSet[propIndex][1]).toHaveBeenCalledTimes(propSetExpect);
    expect(propUnset[propIndex][1]).toHaveBeenCalledTimes(propUnsetExpect);
  };
  // write the attribute
  const attributeTest = () => {
    const attrVal = attribute!.value;
    testElement[attrVal === null ? "removeAttribute" : "setAttribute"](
      attribute!.name,
      // @ts-expect-error
      serializeFn(attrVal),
    );
    expect(testElement[property.name]).toStrictEqual(property.value);
    expect(testElement.getAttribute(attribute!.name)).toBe(
      serializeFn(attribute!.value),
    );
    expect(propChanged[propIndex][1]).toHaveBeenCalledTimes(propChangedExpect);
    expect(propSet[propIndex][1]).toHaveBeenCalledTimes(propSetExpect);
    expect(propUnset[propIndex][1]).toHaveBeenCalledTimes(propUnsetExpect);
  };
  propertyTest();
  if (attribute) {
    // attribute-backed: both directions
    attributeTest();
    testElement[property.name] = oldValue;
    vi.clearAllMocks();
    attributeTest();
    propertyTest();
  }
  vi.clearAllMocks();
};

const testProps = (
  testElement: HTMLTestElementElement,
  matrices: PropTestMatrix[],
) => {
  matrices.forEach((matrix) => testProp(testElement, matrix));
};

describe("Neutron: test-element", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    serializeFn = (v) => v;
    deserializeFn = (v) => v;
    vi.clearAllMocks();
  });
  let testElement: HTMLTestElementElement;
  beforeEach(() => {
    document.body.innerHTML = `<test-element><p></p></test-element>`;
    testElement = document.querySelector("test-element")!;
  });
  const testMatrix1 = [
    {
      property: {
        name: "myString",
        value: "foo",
      },
      attribute: {
        name: "my-string",
        value: "foo",
      },
      propIndex: 0,
      propChangedExpect: 1,
      propSetExpect: 1,
      propUnsetExpect: 0,
    },
    {
      property: {
        name: "myString",
        value: null,
      },
      attribute: {
        name: "my-string",
        value: null,
      },
      propIndex: 0,
      propChangedExpect: 1,
      propSetExpect: 0,
      propUnsetExpect: 1,
    },
    {
      property: {
        name: "myString",
        value: "",
      },
      attribute: {
        name: "my-string",
        value: "",
      },
      propIndex: 0,
      propChangedExpect: 1,
      propSetExpect: 1,
      propUnsetExpect: 0,
    },
  ];
  it("calls correct string prop callbacks", async () => {
    testProps(testElement, testMatrix1);
  });
  it("calls correct string prop callbacks with serialize and deserialize", async () => {
    serializeFn = (v) => (typeof v === "string" ? `serialized:${v}` : v);
    deserializeFn = (v) =>
      typeof v === "string" ? (v as string).replace("serialized:", "") : v;
    testProps(testElement, testMatrix1);
  });

  const testMatrix2 = [
    {
      property: {
        name: "myNumber",
        value: 1,
      },
      attribute: {
        name: "my-number",
        value: "1",
      },
      propIndex: 1,
      propChangedExpect: 1,
      propSetExpect: 1,
      propUnsetExpect: 0,
    },
    {
      property: {
        name: "myNumber",
        value: 0,
      },
      attribute: {
        name: "my-number",
        value: "0",
      },
      propIndex: 1,
      propChangedExpect: 1,
      propSetExpect: 1,
      propUnsetExpect: 0,
    },
    {
      property: {
        name: "myNumber",
        value: null,
      },
      attribute: {
        name: "my-number",
        value: null,
      },
      propIndex: 1,
      propChangedExpect: 1,
      propSetExpect: 0,
      propUnsetExpect: 1,
    },
  ];

  it("calls correct number prop callbacks", async () => {
    testProps(testElement, testMatrix2);
  });

  it("calls correct number prop callbacks with serialize and deserialize", async () => {
    serializeFn = (v) => (typeof v === "number" ? `serialized:${v}` : v);
    deserializeFn = (v) =>
      typeof v === "string" ? (v as string).replace("serialized:", "") : v;
    testProps(testElement, testMatrix2);
  });

  const testMatrix3 = [
    {
      property: {
        name: "myBoolean",
        value: true,
      },
      attribute: {
        name: "my-boolean",
        value: "",
      },
      propIndex: 2,
      propChangedExpect: 1,
      propSetExpect: 1,
      propUnsetExpect: 0,
    },
    {
      property: {
        name: "myBoolean",
        value: false,
      },
      attribute: {
        name: "my-boolean",
        value: null,
      },
      propIndex: 2,
      propChangedExpect: 1,
      propSetExpect: 0,
      propUnsetExpect: 1,
    },
  ];

  it("calls correct boolean prop callbacks", async () => {
    testProps(testElement, testMatrix3);
  });

  it("calls correct boolean prop callbacks with serialize and deserialize", async () => {
    serializeFn = (v) => (typeof v === "boolean" ? `serialized:${v}` : v);
    deserializeFn = (v) =>
      typeof v === "string" ? (v as string).replace("serialized:", "") : v;
    testProps(testElement, testMatrix3);
  });

  const testMatrix4 = [
    {
      property: {
        name: "myTokens",
        value: ["foo", "bar"],
      },
      attribute: {
        name: "my-tokens",
        value: "foo bar",
      },
      propIndex: 3,
      propChangedExpect: 1,
      propSetExpect: 1,
      propUnsetExpect: 0,
    },
    {
      property: {
        name: "myTokens",
        value: [],
      },
      attribute: {
        name: "my-tokens",
        value: "",
      },
      propIndex: 3,
      propChangedExpect: 1,
      propSetExpect: 1,
      propUnsetExpect: 0,
    },
    {
      property: {
        name: "myTokens",
        value: null,
      },
      attribute: {
        name: "my-tokens",
        value: null,
      },
      propIndex: 3,
      propChangedExpect: 1,
      propSetExpect: 0,
      propUnsetExpect: 1,
    },
  ];

  it("calls correct tokens prop callbacks", async () => {
    testProps(testElement, testMatrix4);
  });

  it("calls correct tokens prop callbacks with serialize and deserialize", async () => {
    serializeFn = (v) => (typeof v === "string" ? `serialized:${v}` : v);
    deserializeFn = (v) =>
      typeof v === "string" ? (v as string).replace("serialized:", "") : v;
    testProps(testElement, testMatrix4);
  });

  const p = createElement("p");
  const testMatrix5A = [
    {
      property: {
        name: "pTag",
        value: p,
      },
      propIndex: 4,
      propChangedExpect: 1,
      propSetExpect: 1,
      propUnsetExpect: 0,
    },
  ];
  const span = createElement("span");
  const testMatrix5B = [
    {
      property: {
        name: "pTag",
        value: span,
      },
      propIndex: 4,
      propChangedExpect: 1,
      propSetExpect: 1,
      propUnsetExpect: 0,
    },
    {
      property: {
        name: "pTag",
        value: null,
      },
      propIndex: 4,
      propChangedExpect: 1,
      propSetExpect: 0,
      propUnsetExpect: 1,
    },
  ];

  it("calls correct element prop callbacks", async () => {
    const { propSet } = TestElement.builtConfig.lifecycles;
    (propSet[4][1] as Mock).mockImplementation(() => ({
      pTag: { autofocus: true },
    }));

    testProps(testElement, testMatrix5A);
    expect(testElement.pTag!.autofocus).toBe(true);
    testProps(testElement, testMatrix5B);
  });

  it("calls correct element prop callbacks with serialize and deserialize", async () => {
    const { propSet } = TestElement.builtConfig.lifecycles;
    (propSet[4][1] as Mock).mockImplementation(() => ({
      pTag: { autofocus: false },
    }));
    serializeFn = (v) => (v ? new WeakRef(v) : v);
    // @ts-expect-error
    deserializeFn = (v) => (v ? v.deref() : v);
    testProps(testElement, testMatrix5A);
    expect(testElement.pTag!.autofocus).toBe(false);
    testProps(testElement, testMatrix5B);
  });

  const promise1 = new Promise((resolve) => resolve("resolved"));
  const promise2 = new Promise((resolve) => resolve("resolved"));
  const testMatrix6 = [
    {
      property: {
        name: "myPromise",
        value: promise1,
      },
      propIndex: 5,
      propChangedExpect: 1,
      propSetExpect: 1,
      propUnsetExpect: 0,
    },
    {
      property: {
        name: "myPromise",
        value: promise2,
      },
      propIndex: 5,
      propChangedExpect: 1,
      propSetExpect: 1,
      propUnsetExpect: 0,
    },
    {
      property: {
        name: "myPromise",
        value: null,
      },
      propIndex: 5,
      propChangedExpect: 1,
      propSetExpect: 0,
      propUnsetExpect: 1,
    },
  ];

  it("calls correct promise prop callbacks", async () => {
    testProps(testElement, testMatrix6);
  });

  it("calls correct promise prop callbacks with serialize and deserialize", async () => {
    serializeFn = (v) => (v ? new WeakRef(v) : v);
    // @ts-expect-error
    deserializeFn = (v) => (v ? v.deref() : v);
    testProps(testElement, testMatrix6);
  });

  const obj = { foo: "bar" };
  const testMatrix7A = [
    {
      property: {
        name: "myObject",
        value: obj,
      },
      propIndex: 6,
      propChangedExpect: 1,
      propSetExpect: 1,
      propUnsetExpect: 0,
    },
    {
      property: {
        name: "myObject",
        value: obj,
      },
      propIndex: 6,
      propChangedExpect: 0,
      propSetExpect: 0,
      propUnsetExpect: 0,
    },
    {
      property: {
        name: "myObject",
        // test with identical object
        value: { foo: "bar" },
      },
      propIndex: 6,
      propChangedExpect: 1,
      propSetExpect: 1,
      propUnsetExpect: 0,
    },
    {
      property: {
        name: "myObject",
        value: null,
      },
      propIndex: 6,
      propChangedExpect: 1,
      propSetExpect: 0,
      propUnsetExpect: 1,
    },
  ];
  const testMatrix7B = [
    {
      property: {
        name: "myObject",
        value: obj,
      },
      propIndex: 6,
      propChangedExpect: 1,
      propSetExpect: 1,
      propUnsetExpect: 0,
    },
    {
      property: {
        name: "myObject",
        value: obj,
      },
      propIndex: 6,
      // unlike A: JSON.stringify/parse makes a new object, so it notifies
      propChangedExpect: 1,
      propSetExpect: 1,
      propUnsetExpect: 0,
    },
  ];

  it("calls correct object prop callbacks", async () => {
    testProps(testElement, testMatrix7A);
  });
  it("calls correct object prop callbacks with serialize and deserialize", async () => {
    serializeFn = (v) => (v ? { b: v } : v);
    deserializeFn = (v) => (v ? (v as { b: unknown }).b : v);
    testProps(testElement, testMatrix7A);
  });
  it("calls correct object prop callbacks with serialize and deserialize B", async () => {
    serializeFn = (v) => (v ? JSON.stringify(v) : v);
    deserializeFn = (v) => (v ? JSON.parse(v as string) : v);
    testProps(testElement, testMatrix7B);
  });

  const arr = [1, 2, 3];
  const testMatrix8 = [
    {
      property: {
        name: "myArray",
        value: arr,
      },
      propIndex: 7,
      propChangedExpect: 1,
      propSetExpect: 1,
      propUnsetExpect: 0,
    },
    {
      property: {
        name: "myArray",
        value: null,
      },
      propIndex: 7,
      propChangedExpect: 1,
      propSetExpect: 0,
      propUnsetExpect: 1,
    },
  ];

  it("calls correct array prop callbacks", async () => {
    testProps(testElement, testMatrix8);
  });
  it("calls correct array prop callbacks with serialize and deserialize", async () => {
    serializeFn = (v) => (v ? new WeakRef(v) : v);
    // @ts-expect-error
    deserializeFn = (v) => (v ? v.deref() : v);
    testProps(testElement, testMatrix8);
  });

  const d = { foo: "bar" };
  const testMatrix9 = [
    {
      property: {
        name: "provision",
        value: d,
      },
      propIndex: 8,
      propChangedExpect: 1,
      propSetExpect: 1,
      propUnsetExpect: 0,
    },
    {
      property: {
        name: "provision",
        value: null,
      },
      propIndex: 8,
      propChangedExpect: 1,
      propSetExpect: 0,
      propUnsetExpect: 1,
    },
  ];

  it("calls correct provision prop callbacks", async () => {
    testProps(testElement, testMatrix9);
  });
  it("calls correct provision prop callbacks with serialize and deserialize", async () => {
    serializeFn = (v) => (v ? new WeakRef(v) : v);
    // @ts-expect-error
    deserializeFn = (v) => (v ? v.deref() : v);
    testProps(testElement, testMatrix9);
  });
  afterAll(() => {
    vi.clearAllMocks();
  });
});

const TestElement2 = Neutron({
  tag: "test-element2",
  props: {
    formAction: {
      type: String,
      defaultValue: () => "get",
      isValid: (value: string) =>
        ["get", "post", "put", "delete", "patch", "options", "head"].includes(
          value,
        ),
    },
    positiveCounter: {
      type: Number,
      defaultValue: () => 1,
      isValid: (value: number) => value >= 1,
    },
    falseBoolean: {
      type: Boolean,
      isValid: (value: boolean) => value === false,
    },
    mouseEventTokens: {
      type: TokenList,
      defaultValue: () => ["click", "mouseover", "mouseout"],
      isValid: (value: string) =>
        ["click", "mouseover", "mouseout"].includes(value),
    },
    plainObject: {
      type: Object,
      defaultValue: () => ({}),
      isValid: (value: Record<string, any>) =>
        typeof value === "object" && !Array.isArray(value) && value !== null,
    },
    pTag: {
      type: HTMLParagraphElement,
      isValid: (value: HTMLParagraphElement) =>
        value instanceof HTMLParagraphElement,
    },
    myPromise: {
      type: Promise,
      defaultValue: () => null,
      // @ts-expect-error
      isValid: (value: Promise<any>) => !value.customValue,
    },
  },
});
TestElement2.define();
declare global {
  type TTestElement2Element = typeof TestElement2.CustomElement;
  interface HTMLTestElement2Element extends TTestElement2Element {}
  interface Window {
    HTMLTestElement2Element: HTMLTestElement2Element;
  }
  interface HTMLElementTagNameMap {
    "test-element2": HTMLTestElement2Element;
  }
}
describe("Neutron: test-element2", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("uses default values if not set", () => {
    document.body.innerHTML = `<test-element2><p></p></test-element2>`;
    const testElement2 = document.querySelector("test-element2")!;
    expect(testElement2.formAction).toBe("get");
    expect(testElement2.positiveCounter).toBe(1);
    expect(testElement2.falseBoolean).toBe(false);
    expect(testElement2.mouseEventTokens).toEqual([
      "click",
      "mouseover",
      "mouseout",
    ]);
    expect(testElement2.plainObject).toEqual({});
    expect(testElement2.pTag).toBe(null);
    expect(testElement2.myPromise).toBe(null);
  });

  it("accepts valid values", () => {
    document.body.innerHTML = `<test-element2><p></p></test-element2>`;
    const testElement2 = document.querySelector("test-element2")!;
    testElement2.formAction = "post";
    expect(testElement2.formAction).toBe("post");
    // falsy, not nullish: fails `isValid`, back to default
    testElement2.formAction = "";
    expect(testElement2.formAction).toBe("get");
    testElement2.positiveCounter = 2;
    expect(testElement2.positiveCounter).toBe(2);
    // same: 0 is invalid for a positive counter
    testElement2.positiveCounter = 0;
    expect(testElement2.positiveCounter).toBe(1);
    testElement2.falseBoolean = false;
    expect(testElement2.falseBoolean).toBe(false);
    testElement2.mouseEventTokens = ["click", "mouseover"];
    expect(testElement2.mouseEventTokens).toEqual(["click", "mouseover"]);
    testElement2.plainObject = { foo: "bar" };
    expect(testElement2.plainObject).toEqual({ foo: "bar" });
    testElement2.pTag = document.createElement("p");
    expect(testElement2.pTag).toBeInstanceOf(HTMLParagraphElement);
    testElement2.myPromise = new Promise((resolve) => resolve("resolved"));
    expect(testElement2.myPromise).toBeInstanceOf(Promise);
  });

  it("rejects invalid values and uses default values", () => {
    document.body.innerHTML = `<test-element2><p></p></test-element2>`;
    const testElement2 = document.querySelector("test-element2")!;
    testElement2.formAction = "invalid";
    expect(testElement2.formAction).toBe("get");
    testElement2.positiveCounter = -1;
    expect(testElement2.positiveCounter).toBe(1);
    testElement2.falseBoolean = true;
    expect(testElement2.falseBoolean).toBe(false);
    testElement2.mouseEventTokens = ["submit"];
    expect(testElement2.mouseEventTokens).toEqual([]);
    testElement2.plainObject = [];
    expect(testElement2.plainObject).toEqual({});
    testElement2.pTag = document.createElement("div");
    expect(testElement2.pTag).toBe(null);
    const aPromise = new Promise((resolve) => resolve("resolved"));
    // @ts-expect-error
    aPromise.customValue = true;
    testElement2.myPromise = aPromise;
    expect(testElement2.myPromise).toBe(null);
  });

  it("tokens as props: validation", () => {
    document.body.innerHTML = `<test-element2><p></p></test-element2>`;
    const testElement2 = document.querySelector("test-element2")!;
    // nullish prop → default
    expect(testElement2.mouseEventTokens).toEqual([
      "click",
      "mouseover",
      "mouseout",
    ]);
    // every token invalid → []
    testElement2.mouseEventTokens = ["submit"];
    expect(testElement2.mouseEventTokens).toEqual([]);
    // all valid → kept
    testElement2.mouseEventTokens = ["mouseout"];
    expect(testElement2.mouseEventTokens).toEqual(["mouseout"]);
    // mix: only the valid tokens
    testElement2.mouseEventTokens = ["mouseout", "paused"];
    expect(testElement2.mouseEventTokens).toEqual(["mouseout"]);
    // invalid prop → default
    // @ts-expect-error
    testElement2.mouseEventTokens = null;
    expect(testElement2.mouseEventTokens).toEqual([
      "click",
      "mouseover",
      "mouseout",
    ]);
  });

  it("tokens as attrs: validation", () => {
    document.body.innerHTML = `<test-element2><p></p></test-element2>`;
    const testElement2 = document.querySelector("test-element2")!;
    // nullish attr → default
    expect(testElement2.mouseEventTokens).toEqual([
      "click",
      "mouseover",
      "mouseout",
    ]);
    // every token invalid → []
    testElement2.setAttribute("mouse-event-tokens", "submit");
    expect(testElement2.mouseEventTokens).toEqual([]);
    // all valid → kept
    testElement2.setAttribute("mouse-event-tokens", "mouseout");
    expect(testElement2.mouseEventTokens).toEqual(["mouseout"]);
    // mix: only the valid tokens
    testElement2.setAttribute("mouse-event-tokens", "mouseout paused");
    expect(testElement2.mouseEventTokens).toEqual(["mouseout"]);
    // attr removed → default
    testElement2.removeAttribute("mouse-event-tokens");
    expect(testElement2.mouseEventTokens).toEqual([
      "click",
      "mouseover",
      "mouseout",
    ]);
  });
});

describe("Neutron", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("Calls and processes lifecycle hooks correctly", async () => {
    const {
      constructed,
      connected,
      disconnected,
      // adopted,
      propChanged,
      propSet,
      propUnset,
      promiseResolved,
      promiseRejected,
      broadcast,
      event,
      eventDefault,
    } = TestElement.builtConfig.lifecycles;
    const changeState = () => ({
      myString: "foo",
      myNumber: 42,
      myBoolean: true,
      myTokens: ["token1", "token2"],
      myObject: { bar: "baz" },
      myArray: [10, 20, 30],
      pTag: document.createElement("p"),
    });

    const resetState = () => ({
      myString: null,
      myBoolean: false,
      myTokens: [],
      myObject: null,
      myArray: null,
      pTag: null,
    });

    const testElement = document.createElement("test-element");

    expect(constructed[0][1]).toHaveBeenCalledTimes(1);
    expect(testElement.myNumber).toBe(null);
    // connect and check the result
    (connected[0][1] as Mock).mockImplementation((element) => {
      expect(element.localName).toBe("test-element");
      expect(testElement.myNumber).toBe(null);
      return changeState();
    });
    //   // connect element
    document.body.appendChild(testElement);

    expect(testElement.myString).toBe("foo");
    expect(testElement.myNumber).toBe(42);
    expect(testElement.myBoolean).toBe(true);
    expect(testElement.myTokens).toEqual(["token1", "token2"]);
    expect(testElement.myObject).toEqual({ bar: "baz" });
    expect(testElement.myArray).toEqual([10, 20, 30]);
    expect(testElement.pTag).toBeInstanceOf(HTMLParagraphElement);
    expect(connected[0][1]).toHaveBeenCalledTimes(1);
    expect(propChanged[1][1]).toHaveBeenCalledTimes(1);
    expect(propSet[1][1]).toHaveBeenCalledTimes(1);
    expect(propUnset[1][1]).toHaveBeenCalledTimes(0);
    expect(broadcast[0][1]).toHaveBeenCalledTimes(0);
    expect(event[0][1]).toHaveBeenCalledTimes(0);
    expect(eventDefault[0][1]).toHaveBeenCalledTimes(0);

    //   // reset state, check changeData
    (propSet[1][1] as Mock).mockImplementation(({ myNumber }, previous) => {
      expect(myNumber).toEqual(0);
      expect(previous.myNumber).toEqual(42);
      return resetState();
    });
    testElement.myNumber = 0;
    expect(testElement.myString).toBe(null);
    expect(testElement.myNumber).toBe(0);
    expect(testElement.myBoolean).toBe(false);
    expect(testElement.myTokens).toEqual([]);
    expect(testElement.myObject).toBe(null);
    expect(testElement.myArray).toBe(null);
    expect(testElement.pTag).toBe(null);
    expect(testElement.myNumber).toBe(0);
    expect(propChanged[1][1]).toHaveBeenCalledTimes(2);
    expect(propSet[1][1]).toHaveBeenCalledTimes(2);
    expect(propUnset[1][1]).toHaveBeenCalledTimes(0);

    // array of effects: last write wins per key
    (propSet[1][1] as Mock).mockImplementation(() => [
      { myString: "123" },
      { myString: "234", myBoolean: true },
    ]);
    testElement.myNumber++;
    expect(testElement.myString).toBe("234");
    expect(testElement.myBoolean).toBe(true);

    const makePromise = () => {
      let resolve, reject;
      const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
      });
      return { promise, resolve, reject };
    };

    // resolved Promise → `onPromiseResolved`
    const promise1 = makePromise();
    (propSet[1][1] as Mock).mockImplementation(() => ({
      myPromise: promise1.promise,
    }));
    testElement.myNumber++;
    promise1.resolve("resolved");
    await wait(1);
    expect(promiseResolved[0][1]).toHaveBeenCalledTimes(1);
    expect(promiseRejected[0][1]).toHaveBeenCalledTimes(0);

    // rejected Promise → `onPromiseRejected`
    const promise2 = makePromise();
    (propSet[1][1] as Mock).mockImplementation(() => ({
      myPromise: promise2.promise,
    }));
    testElement.myNumber++;
    promise2.reject("rejected");
    await wait(1);
    expect(promiseResolved[0][1]).toHaveBeenCalledTimes(1);
    expect(promiseRejected[0][1]).toHaveBeenCalledTimes(1);

    // effect can emit while it writes
    expect(event[0][1]).toHaveBeenCalledTimes(0);
    (propSet[1][1] as Mock).mockImplementation(() => [
      { myString: "baz", emit: ["test-element-event"] },
    ]);
    await waitForEvent(testElement, "test-element-event", () => {
      testElement.myNumber!++;
    });
    expect(testElement.myString).toBe("baz");
    expect(event[0][1]).toHaveBeenCalledTimes(1);

    // un-prevented event → `onEventDefault`
    expect(eventDefault[0][1]).toHaveBeenCalledTimes(0);
    (propSet[1][1] as Mock).mockImplementation(() => [
      { emit: ["test-element-event-other"] },
    ]);
    await waitForEvent(
      testElement,
      "test-element-event-other",
      () => {
        testElement.myNumber!++;
      },
      1,
    );
    expect(eventDefault[0][1]).toHaveBeenCalledTimes(1);

    // `preventDefault()` skips `onEventDefault`
    const listener1 = (event) => {
      event.preventDefault();
    };
    document.body.addEventListener("test-element-event-other", listener1);
    await waitForEvent(
      testElement,
      "test-element-event-other",
      () => {
        testElement.myNumber!++;
      },
      1,
    );
    expect(eventDefault[0][1]).toHaveBeenCalledTimes(1);
    document.body.removeEventListener("test-element-event-other", listener1);

    //   // fires event on child and does not fire default event handler if the parent is not the target
    const listener2 = vi.fn().mockImplementation((event) => {
      expect(event.target).toBe(testElement.pTag);
    });
    (propSet[1][1] as Mock).mockImplementation((element) => {
      const pTag = document.createElement("p");
      element.appendChild(pTag);
      return [{ pTag }, { pTag: { emit: ["test-element-event-other"] } }];
    });
    document.body.addEventListener("test-element-event-other", listener2);
    await waitForEvent(
      testElement,
      "test-element-event-other",
      () => {
        testElement.myNumber!++;
      },
      1,
    );
    expect(eventDefault[0][1]).toHaveBeenCalledTimes(1);
    expect(listener2).toHaveBeenCalledTimes(1);
    document.body.removeEventListener("test-element-event-other", listener2);

    // `provision` emits `neutron-provision`
    (propSet[1][1] as Mock).mockImplementation(() => ({
      provision: { randomData: "foobar" },
    }));
    const listener3 = vi.fn().mockImplementation((event) => {
      expect(event.target).toBe(testElement);
      expect(event.target.provision).toEqual({ randomData: "foobar" });
    });
    document.body.addEventListener("neutron-provision", listener3);
    await waitForEvent(document.body, "neutron-provision", () => {
      testElement.myNumber!++;
    });
    expect(listener3).toHaveBeenCalledTimes(1);
    document.body.removeEventListener("neutron-provision", listener3);

    // child-element effect
    (propSet[1][1] as Mock).mockImplementation(() => {
      return [
        { pTag: { autofocus: true } },
        { pTag: { emit: ["p-modified"] } },
      ];
    });
    await waitForEvent(
      testElement.pTag,
      "p-modified",
      () => {
        testElement.myNumber!++;
      },
      0,
    );
    expect(testElement.pTag!.autofocus).toBe(true);

    // `style` deep-merges
    (propSet[1][1] as Mock).mockImplementation(() => ({
      style: { color: "blue", marginTop: "30px" },
    }));
    testElement.myNumber++;
    expect(testElement.style.color).toBe("blue");
    expect(testElement.style.marginTop).toBe("30px");

    // `addListener` from an effect
    const listener4 = vi.fn().mockImplementation((event) => {
      expect(event.target).toBe(testElement);
      expect(event.detail).toEqual({ myString: "baz" });
    });
    (propSet[1][1] as Mock).mockImplementation(() => ({
      addListener: ["test-element-event-bar", listener4],
    }));
    await waitForEvent(testElement, "test-element-event-bar", () => {
      testElement.myNumber!++;
      testElement.dispatchEvent(
        new CustomEvent("test-element-event-bar", {
          detail: { myString: "baz" },
        }),
      );
    });
    expect(listener4).toHaveBeenCalledTimes(1);
    // `removeListener` from an effect
    (propSet[1][1] as Mock).mockImplementation(() => ({
      removeListener: ["test-element-event-bar", listener4],
    }));
    await waitForEvent(testElement, "test-element-event-bar", async () => {
      testElement.myNumber!++;
      testElement.dispatchEvent(new CustomEvent("test-element-event-bar"));
    });
    expect(listener4).toHaveBeenCalledTimes(1);

    // CommonElement listeners
    // addListeners
    (propSet[1][1] as Mock).mockImplementation(() => [
      {
        addListeners: [
          ["test-element-event-foo", listener4],
          ["test-element-event-bar", listener4],
        ],
      },
      {
        emits: [
          ["test-element-event-foo", { detail: { myString: "baz" } }],
          ["test-element-event-bar", { detail: { myString: "baz" } }],
        ],
      },
    ]);
    await waitForEvent(testElement, "test-element-event-foo", () => {
      testElement.myNumber!++;
    });
    expect(listener4).toHaveBeenCalledTimes(3);

    // removeListeners
    (propSet[1][1] as Mock).mockImplementation(() => [
      {
        removeListeners: [
          ["test-element-event-foo", listener4],
          ["test-element-event-bar", listener4],
        ],
      },
      {
        emits: [
          ["test-element-event-foo", { detail: { myString: "baz" } }],
          ["test-element-event-bar", { detail: { myString: "baz" } }],
        ],
      },
    ]);
    await waitForEvent(testElement, "test-element-event-foo", () => {
      testElement.myNumber!++;
    });
    expect(listener4).toHaveBeenCalledTimes(3);

    // toggleListeners
    (propSet[1][1] as Mock).mockImplementation(() => [
      {
        toggleListeners: [
          // next test turns this one off
          ["test-element-event-dynamic", listener4, true],
          ["test-element-event-bar", listener4, false],
        ],
      },
      {
        emits: [
          ["test-element-event-dynamic", { detail: { myString: "baz" } }],
          ["test-element-event-bar", { detail: { myString: "baz" } }],
        ],
      },
    ]);
    await waitForEvent(testElement, "test-element-event-bar", () => {
      testElement.myNumber!++;
    });
    // `test-element-event-bar` was toggled off
    expect(listener4).toHaveBeenCalledTimes(4);

    // disconnect drops listeners
    const preDisconnectListeners = getEventListeners(testElement);
    const preDisconnectProps = {
      myString: testElement.myString,
      myNumber: testElement.myNumber,
      myBoolean: testElement.myBoolean,
      myTokens: testElement.myTokens,
      myObject: testElement.myObject,
      myArray: testElement.myArray,
      pTag: testElement.pTag,
      provision: testElement.provision,
    };
    document.body.removeChild(testElement);
    // disconnect is a microtask
    await wait(0);
    await waitForEvent(
      testElement,
      "test-element-event-dynamic",
      () => {
        testElement.dispatchEvent(
          new CustomEvent("test-element-event-dynamic", {
            detail: { myString: "baz" },
          }),
        );
      },
      1,
    );
    expect(disconnected[0][1]).toHaveBeenCalledTimes(1);
    expect(testElement.wasMounted).toBe(true);
    expect(testElement.isMounted).toBe(false);
    expect(listener4).toHaveBeenCalledTimes(4);
    expect(getEventListeners(testElement)).toEqual({}); // all listeners should be removed

    //   // should keep state and re-attach listeners on reconnected element
    (connected[0][1] as Mock).mockImplementation(() => {});
    document.body.appendChild(testElement);
    expect(connected[0][1]).toHaveBeenCalledTimes(2);
    expect(testElement.isMounted).toBe(true);
    expect(testElement.wasMounted).toBe(true);
    expect(getEventListeners(testElement)).toEqual(preDisconnectListeners);
    expect(testElement.myString).toBe(preDisconnectProps.myString);
    expect(testElement.myNumber).toBe(preDisconnectProps.myNumber);
    expect(testElement.myBoolean).toBe(preDisconnectProps.myBoolean);
    expect(testElement.myTokens).toEqual(preDisconnectProps.myTokens);
    expect(testElement.myObject).toEqual(preDisconnectProps.myObject);
    expect(testElement.myArray).toEqual(preDisconnectProps.myArray);
    expect(testElement.pTag).toBe(preDisconnectProps.pTag);
    expect(testElement.myNumber).toBe(preDisconnectProps.myNumber);
    expect(testElement.provision).toEqual(preDisconnectProps.provision);

    const testElement2 = document.createElement("test-element");
    document.body.appendChild(testElement2);

    (broadcast[0][1] as Mock).mockImplementation((element, event) => {
      expect(event.type).toBe("test-broadcast");
      expect(event.detail.broadcastMessage).toEqual("foo");
      return [
        element === event.detail.emittingElement && {
          myTokens: ["foo", "bar"],
        },
        { myString: "broadcasted" },
      ];
    });
    // broadcasts and receives broadcast
    (propSet[1][1] as Mock).mockImplementation((element) => {
      return {
        broadcast: [
          "test-broadcast",
          {
            detail: {
              broadcastMessage: "foo",
              emittingElement: element,
              num: Math.random(),
            },
          },
        ],
      };
    });
    testElement.myNumber++;
    await wait(1);
    expect(broadcast[0][1]).toHaveBeenCalledTimes(2);
    expect(testElement.myString).toBe("broadcasted");
    expect(testElement.myTokens).to.deep.equal(["foo", "bar"]);
    expect(testElement2.myString).toBe("broadcasted");

    clearEventListeners(testElement);
  });

  afterAll(() => {
    vi.clearAllMocks();
  });
});
