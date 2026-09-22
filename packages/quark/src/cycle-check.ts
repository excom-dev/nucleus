/**
 * Static write-cycle warning, once per sheet at construction.
 *
 * A rule's selector gates on attrs (`[is-open]`, `:not([x])`, a literal
 * `attr("x")` read) and its declarations write attrs. If A writes what
 * B gates on and B writes what A gates on, they can re-trigger each
 * other. Cycles that settle (Quark skips equal writes) are fine; ones
 * that don't get cut by the loop guard. Still worth naming at build,
 * once, with the rules involved.
 *
 * Self-edges (`input[value] { value: … }`) are the usual idempotent
 * idiom and are not reported. `content`, `dataset`, `ariaset`, `class`,
 * and `--custom-property` do not name an attr and are ignored. `@on`
 * block rules never run in passes and are skipped.
 */
import { StyleProperty } from "./properties";
import type { Quark } from "./quark";
import type { Rule } from "./rule";
import { QuarkLogger } from "./utils";
import { LoopGuard } from "@excom/kit-utils";

const NON_ATTRIBUTE_KEYS = new Set(["content", "dataset", "ariaset", "class"]);

/** Attribute names a rule writes with plain `name: value` declarations. */
const writtenAttrs = (rule: Rule): Set<string> => {
  const names = new Set<string>();
  rule.attributes.forEach((prop) => {
    if (prop instanceof StyleProperty) return;
    if (NON_ATTRIBUTE_KEYS.has(prop.key)) return;
    names.add(prop.key);
  });
  return names;
};

/** Strongly connected components with more than one rule (Tarjan). */
const cycles = (rules: Rule[], edges: Map<Rule, Set<Rule>>): Rule[][] => {
  let index = 0;
  const indices = new Map<Rule, number>();
  const lowlinks = new Map<Rule, number>();
  const onStack = new Set<Rule>();
  const stack: Rule[] = [];
  const found: Rule[][] = [];
  const connect = (rule: Rule) => {
    indices.set(rule, index);
    lowlinks.set(rule, index);
    index++;
    stack.push(rule);
    onStack.add(rule);
    edges.get(rule)?.forEach((next) => {
      if (!indices.has(next)) {
        connect(next);
        lowlinks.set(rule, Math.min(lowlinks.get(rule)!, lowlinks.get(next)!));
      } else if (onStack.has(next)) {
        lowlinks.set(rule, Math.min(lowlinks.get(rule)!, indices.get(next)!));
      }
    });
    if (lowlinks.get(rule) === indices.get(rule)) {
      const component: Rule[] = [];
      let member: Rule;
      do {
        member = stack.pop()!;
        onStack.delete(member);
        component.push(member);
      } while (member !== rule);
      if (component.length > 1) found.push(component.reverse());
    }
  };
  rules.forEach((rule) => {
    if (!indices.has(rule)) connect(rule);
  });
  return found;
};

/**
 * Warn (once per sheet) when attr writes and selector gates form a
 * cycle. Returns the cycles for tests / tooling.
 */
export const warnStaticCycles = (quark: Quark): Rule[][] => {
  const rules = quark.rules.filter((rule) => !rule.isEventBlock);
  if (rules.length < 2) return [];
  const writes = new Map(rules.map((rule) => [rule, writtenAttrs(rule)]));
  const edges = new Map<Rule, Set<Rule>>();
  rules.forEach((from) => {
    const written = writes.get(from)!;
    if (!written.size) return;
    rules.forEach((to) => {
      if (to === from) return;
      for (const name of written) {
        if (to.observedAttrs.has(name)) {
          let targets = edges.get(from);
          if (!targets) edges.set(from, (targets = new Set()));
          targets.add(to);
          break;
        }
      }
    });
  });
  if (!edges.size) return [];
  const found = cycles(rules, edges);
  found.forEach((component) => {
    const members = new Set(component);
    const description = component
      .map((rule) => {
        const shared = [...writes.get(rule)!].filter((name) =>
          component.some(
            (other) =>
              other !== rule &&
              members.has(other) &&
              other.observedAttrs.has(name)
          )
        );
        return `\`${rule.selector}\` writes [${shared.join(", ")}]`;
      })
      .join("; ");
    QuarkLogger.warn({
      method: "cycleCheck",
      message: `Quark: rules gate on attributes they write for each other — ${description}. A cycle that never settles is cut by the loop guard after ${LoopGuard.limit} hops; make the writes converge or break the cycle.`,
    });
  });
  return found;
};
