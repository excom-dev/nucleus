import { Neutron } from "@excom/neutron";

export const SuperImg = Neutron({
  tag: "super-img",
  props: {
    // options
    imgSrc: String,
    fallbackSrc: String,
    // state
    isSuccess: Boolean,
    isError: String,
    isLoading: Boolean,
    imgElement: HTMLImageElement,
  },
});
SuperImg.onConnected((element) => [
  { imgElement: element.querySelector("img") },
  {
    imgElement: {
      addListeners: [
        [
          "error",
          ({ currentTarget, message }) => {
            return {
              imgElement: {
                src:
                  element.fallbackSrc &&
                  currentTarget?.src !== element.fallbackSrc
                    ? element.fallbackSrc
                    : currentTarget?.src,
              },
              isLoading: false,
              isError: message,
            };
          },
        ],
        [
          "load",
          () => ({
            isLoading: false,
            isSuccess: true,
          }),
        ],
      ],
    },
  },
]).onPropChanged("imgSrc", ({ imgSrc }) => ({
  isSuccess: false,
  isError: null,
  isLoading: true,
  imgElement: { src: imgSrc || undefined },
}));

// TYPE TESTING

/*
 * // type Y = HTMLImageElement extends HTMLElement ? "test" : never;
 * // type ESig = ["my-event", () => void];
 * // type B = (string | (() => void))[]
 * // const foo: B = ["my-event", () => {}];
 * // const bar = foo satisfies ESig;
 * type Y = Array<any> extends Record<symbol, any> ? "yes" : never;
 * const res = (
 *   element
 * ) => [
 *   {
 *     appendChild: ["x"],
 *     xuyz: "foo",
 *   },
 * ];
 * type TEST = ReturnType<typeof res>;
 * const bar = [
 *   {
 *     appendChild: ["x"],
 *     xuyz: "foo",
 *   },
 * ]
 */

// type Obj = Record<symbol, any>;
// type baz = typeof bar extends Array<Obj> ? "yes" : "no";

/*
 * const b = SuperImg.onConnected((element) => [
 *   {
 *     imgElement: element.querySelector("img"),
 *     appendChild: ["x"],
 *     xuyz: "foo",
 *   },
 * ]);
 */

/*
 * SuperImg.onConnected((element) => ({
 *   imgElement: {
 *     src: element.imgSrc,
 *     hidden: true,
 *   },
 *   appendChild: ["x"],
 *   xuyz: "foo",
 * }))
 *   .onPropSet("imgSrc", ({ imgSrc }) => ({
 *     isSuccess: false,
 *     isError: null,
 *     isLoading: true,
 *     imgElement: { src: imgSrc },
 *     x: 1,
 *   }))
 *   .onPropChanged("imgSrc", ({ imgSrc }) => ({
 *     isSuccess: false,
 *     isError: null,
 *     isLoading: true,
 *     imgElement: { src: imgSrc },
 *   }))
 *   .onPropSet(["imgSrc", "isLoading"], ({ imgSrc }) => ({
 *     isSuccess: false,
 *     isError: null,
 *     isLoading: true,
 *     imgElement: { src: imgSrc },
 *     addEventListener: "foo",
 *     removeEventListener: ["bar", () => {}],
 *     appendChild: ["x"],
 *   }))
 *   .onPropSet(["imgSrc", "isLoading"], ({ imgSrc, fallbackSrc }) => ({
 *     isSuccess: false,
 *     isError: null,
 *     isLoading: true,
 *     imgElement: { src: fallbackSrc },
 *     addEventListener: "foo",
 *     removeEventListener: ["bar", () => {}],
 *     appendChild: ["x"],
 *   }))
 *   .onPropUnset("imgSrc", ({ imgSrc, fallbackSrc }) => ({
 *     isSuccess: false,
 *     isError: null,
 *     isLoading: true,
 *     imgElement: {
 *       src: "h",
 *       inert: true,
 *       hidden: "",
 *       fakeProp: fallbackSrc,
 *       removeEventListener: ["bar", () => {}],
 *       toggleListeners: [["foo", () => {}, false]],
 *     },
 *     addEventListener: "foo",
 *     removeEventListener: ["bar", () => {}],
 *     appendChild: ["x"],
 *   }));
 */
