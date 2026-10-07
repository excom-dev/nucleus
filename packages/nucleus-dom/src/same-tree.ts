import { type DefaultTreeAdapterTypes as Parse5, parse } from "parse5";

type Node = Parse5.Node;

/** A parent node's children: a template's are in its content. */
const childrenOf = (node: Parse5.ParentNode): Node[] =>
  "content" in node ? node.content.childNodes : node.childNodes;

/** An element's attributes by namespace and name. */
const attributesOf = ({ attrs }: Parse5.Element) =>
  new Map(
    attrs.map(({ namespace, prefix, name, value }) => [
      `${namespace ?? ""} ${prefix ?? ""} ${name}`,
      value,
    ])
  );

const sameAttributes = (a: Parse5.Element, b: Parse5.Element) => {
  const ours = attributesOf(a);
  const theirs = attributesOf(b);
  return (
    ours.size === theirs.size &&
    [...ours].every(([name, value]) => theirs.get(name) === value)
  );
};

const sameNode = (a: Node, b: Node): boolean => {
  if (a.nodeName !== b.nodeName) return false;
  if ("value" in a) return a.value === (b as Parse5.TextNode).value;
  if ("data" in a) return a.data === (b as Parse5.CommentNode).data;
  if ("publicId" in a) {
    const other = b as Parse5.DocumentType;
    return (
      a.name === other.name &&
      a.publicId === other.publicId &&
      a.systemId === other.systemId
    );
  }
  if ("mode" in a && a.mode !== (b as Parse5.Document).mode) return false;
  if (
    "tagName" in a &&
    (a.namespaceURI !== (b as Parse5.Element).namespaceURI ||
      !sameAttributes(a, b as Parse5.Element))
  )
    return false;
  // what is left is a parent: document, fragment or element
  const ours = childrenOf(a as Parse5.ParentNode);
  const theirs = childrenOf(b as Parse5.ParentNode);
  return (
    ours.length === theirs.length &&
    ours.every((node, index) => sameNode(node, theirs[index]!))
  );
};

/** A node of the tree a browser builds from markup, as plain data (see `parseTree`). */
export type TreeNode =
  | {
      /** Lower case, as parsed: SVG keeps its camel case (`foreignObject`). */
      tag: string;
      /** By name, `xlink:href` for a namespaced one; their order in the tag is not kept. */
      attributes: Record<string, string>;
      /** A `<template>`'s are its content's. */
      children: TreeNode[];
    }
  | { text: string }
  | { comment: string }
  | { doctype: string };

const treeOf = (node: Node): TreeNode => {
  if ("tagName" in node)
    return {
      tag: node.tagName,
      attributes: Object.fromEntries(
        node.attrs.map(({ prefix, name, value }) => [
          prefix ? `${prefix}:${name}` : name,
          value,
        ])
      ),
      children: childrenOf(node).map(treeOf),
    };
  if ("value" in node) return { text: node.value };
  if ("data" in node) return { comment: node.data };
  return { doctype: (node as Parse5.DocumentType).name };
};

/**
 * The nodes of the document a browser builds from `html` (doctype, comments,
 * `<html>`), as plain data: compare a server render (SSR) with what a
 * browser rendered, without a parser of your own.
 */
export const parseTree = (html: string): TreeNode[] =>
  parse(html).childNodes.map(treeOf);

/**
 * Whether two HTML documents build the same tree, as a browser parses them:
 * the same nodes in the same order, text, comments, doctype and attribute
 * values exactly, attributes as a set. Their order within a tag is all it
 * leaves out: e.g. a server render (SSR) whose elements write the same
 * attributes in another order each time, as concurrent work finishes.
 */
export const sameTree = (html: string, other: string): boolean =>
  html === other || sameNode(parse(html), parse(other));
