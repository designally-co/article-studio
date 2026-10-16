"use client";

import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * `renderImageBlock` (preview of the proposed article direction) draws a
 * fenced ```image block in place, given its raw text. Without it the block
 * shows as the code it is.
 */
export function Markdown({
  children,
  renderImageBlock,
}: {
  children: string;
  renderImageBlock?: (raw: string) => ReactNode;
}) {
  const language = /[฀-๿]/.test(children) ? "th" : "en";
  return (
    <div className="prose-draft" lang={language}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={
          renderImageBlock
            ? {
                pre({ node, children: preChildren, ...rest }) {
                  const code = node?.children[0];
                  const className =
                    code && code.type === "element" ? code.properties?.className : undefined;
                  const isImage = Array.isArray(className) && className.includes("language-image");
                  if (isImage && code && code.type === "element") {
                    const text = code.children.map((child) => (child.type === "text" ? child.value : "")).join("");
                    return <>{renderImageBlock(text)}</>;
                  }
                  return <pre {...rest}>{preChildren}</pre>;
                },
              }
            : undefined
        }
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
