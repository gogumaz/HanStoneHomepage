import postcss from 'postcss';

const selectorTokenPattern = /[.#]([_a-zA-Z\u00a0-\uffff][-_a-zA-Z0-9\u00a0-\uffff]*)/gu;

function selectorIsUsed(selector: string, sourceText: string) {
  const tokens = Array.from(selector.matchAll(selectorTokenPattern), match => match[1]);

  // Element, attribute, and root selectors form the shared foundation. A selector
  // with a class or ID belongs to an entry when at least one of its tokens is
  // present in that entry's HTML or runtime script. The deliberately conservative
  // "any token" rule preserves shared compound selectors and dynamic state rules.
  return tokens.length === 0 || tokens.some(token => sourceText.includes(token));
}

export function filterLegacyCss(css: string, sourceText: string) {
  const root = postcss.parse(css);

  root.walkRules(rule => {
    if (rule.parent?.type === 'atrule' && /keyframes$/iu.test(rule.parent.name)) return;

    const usedSelectors = rule.selectors.filter(selector => selectorIsUsed(selector, sourceText));
    if (usedSelectors.length === 0) {
      rule.remove();
      return;
    }

    rule.selectors = usedSelectors;
  });

  root.walkAtRules(atRule => {
    if (atRule.nodes?.length === 0) atRule.remove();
  });

  return root.toString();
}
