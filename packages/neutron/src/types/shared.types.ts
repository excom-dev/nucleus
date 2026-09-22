export type GuaranteedFields<T> = {
  [P in keyof T]: NonNullable<T[P]>;
};

export type GuaranteedField<T, K extends keyof T> = T &
  GuaranteedFields<Pick<T, K>>;

export type NullFields<T> = {
  [P in keyof T]: null;
};
export type NullField<T, K extends keyof T> = T & NullFields<Pick<T, K>>;

export type AnyFunction<Args extends any[] = any[], R = any> = (
  ...args: Args
) => R;

export type Obj<U = {}> = Record<string, any> & U;

export type PickGlobalElement<Tag> = Tag extends keyof HTMLElementTagNameMap
  ? HTMLElementTagNameMap[Tag]
  : HTMLElement;

export type Constructor = abstract new (...args: any) => any;

export type ConstructorType<T> = new (...args: any) => T;
