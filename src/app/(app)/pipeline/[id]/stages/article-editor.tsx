"use client";

import { createContext, useContext, useEffect, useRef, type ReactNode } from "react";
import { EditorContent, Node, NodeViewWrapper, ReactNodeViewRenderer, mergeAttributes, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";

/**
 * PREVIEW ONLY: the draft, always editable (proposed article direction; build
 * session, 2026-10-15: "the draft must be in edit mode only, user can edit the
 * text at anytime").
 *
 * The article is edited as it reads (headings, paragraphs, lists, links), not
 * as Markdown, and there is no edit or preview switch. It still loads and
 * saves Markdown, so everything downstream (blocks, checks, publishing) reads
 * the same text as before.
 *
 * An image block is its own node: the editor cannot type into it, shows the
 * block's card in its place, and writes the same ```image fence back when the
 * article is saved.
 */

const BlockRenderer = createContext<((raw: string) => ReactNode) | null>(null);

function ImageBlockView({ node }: { node: { attrs: { raw?: string } } }) {
  const render = useContext(BlockRenderer);
  return (
    <NodeViewWrapper contentEditable={false} data-image-block-node="">
      {render ? render(node.attrs.raw ?? "") : null}
    </NodeViewWrapper>
  );
}

const ImageBlockNode = Node.create({
  name: "imageBlock",
  group: "block",
  atom: true,
  selectable: false,
  draggable: false,
  // Ahead of the code block, so an ```image fence becomes this node, and any
  // other fence stays a code block.
  priority: 1000,
  addAttributes() {
    return { raw: { default: "" } };
  },
  parseHTML() {
    return [{ tag: "div[data-image-block-node]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-image-block-node": "" })];
  },
  markdownTokenName: "code",
  parseMarkdown: (token, helpers) =>
    token.lang === "image" ? helpers.createNode("imageBlock", { raw: token.text ?? "" }) : [],
  renderMarkdown: (node) => `\`\`\`image\n${(node.attrs?.raw as string | undefined) ?? ""}\n\`\`\``,
  addNodeView() {
    return ReactNodeViewRenderer(ImageBlockView);
  },
});

export function ArticleEditor({
  markdown,
  onChange,
  renderImageBlock,
}: {
  markdown: string;
  onChange: (markdown: string) => void;
  renderImageBlock?: (raw: string) => ReactNode;
}) {
  /* What the editor last said. A change of `markdown` that is not this came
     from elsewhere (a revision, a restored version, a removed block, a new
     draft) and replaces the editor's content; one that is, is the editor's own
     typing coming back round and is left alone, so the cursor does not jump. */
  const lastEmitted = useRef(markdown);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const editor = useEditor({
    extensions: [StarterKit.configure({ link: { openOnClick: false } }), ImageBlockNode, Markdown],
    content: markdown,
    contentType: "markdown",
    immediatelyRender: false,
    editorProps: {
      attributes: { class: "outline-none", "aria-label": "Article text", role: "textbox", "aria-multiline": "true" },
    },
    onUpdate: ({ editor: current }) => {
      const next = current.getMarkdown();
      lastEmitted.current = next;
      onChangeRef.current(next);
    },
  });

  useEffect(() => {
    if (!editor || markdown === lastEmitted.current) return;
    lastEmitted.current = markdown;
    editor.commands.setContent(markdown, { contentType: "markdown", emitUpdate: false });
  }, [editor, markdown]);

  return (
    <BlockRenderer.Provider value={renderImageBlock ?? null}>
      <div className="prose-draft" lang="en">
        <EditorContent editor={editor} />
      </div>
    </BlockRenderer.Provider>
  );
}
