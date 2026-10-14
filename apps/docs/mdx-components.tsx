import defaults from 'fumadocs-ui/mdx';
import type { MDXComponents } from 'mdx/types';

export function getMDXComponents(components?: MDXComponents): MDXComponents {
  return { ...defaults, ...components };
}
export const useMDXComponents = getMDXComponents;
