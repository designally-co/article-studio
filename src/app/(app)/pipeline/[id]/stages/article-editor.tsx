"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  EditorContent,
  Node,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  mergeAttributes,
  useEditor,
  useEditorState,
  type Editor,
  type NodeViewProps,
} from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import {
  Bold,
  ImagePlus,
  Italic,
  Link2,
  List,
  ListOrdered,
  Quote,
  Redo2,
  Undo2,
} from "lucide-react";
import { nextFreeBlockId, parseImageBlockBody } from "@/lib/direction/image-blocks";

/**
 * PREVIEW ONLY: the draft as a rich text editor, filled with the generated
 * article (proposed article direction; build session, 2026-10-15: "the draft
 * must be in edit mode only", "the draft box must be the rich text editor
 * with prefilled generated output").
 *
 * The article is edited as it reads, with a toolbar for text style, emphasis,
 * links, lists and quotes, and an Add image button that puts a new image slot
 * after the paragraph the cursor is in. It still loads and saves Markdown, so
 * blocks, checks and publishing read the same text as before.
 *
 * An image block is its own node: the editor cannot type into it, shows the
 * block's card in its place, and writes the same ```image fence back.
 */

/** What a card can do to the block it sits in, inside the editor. */
export type BlockControls = {
  /** Replace the block's text (its caption, purpose …). */
  update: (raw: string) => void;
  /** Take the block out of the article. */
  remove: () => void;
};

type BlockRender = (raw: string, controls: BlockControls) => ReactNode;
const BlockRenderer = createContext<BlockRender | null>(null);

function ImageBlockView({ node, updateAttributes, deleteNode }: NodeViewProps) {
  const render = useContext(BlockRenderer);
  const raw = (node.attrs.raw as string | undefined) ?? "";
  return (
    <NodeViewWrapper contentEditable={false} data-image-block-node="">
      {render ? render(raw, { update: (next) => updateAttributes({ raw: next }), remove: deleteNode }) : null}
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

/** The ids of the image blocks in the article, in order. */
function blockIds(editor: Editor): string[] {
  const ids: string[] = [];
  editor.state.doc.descendants((node) => {
    if (node.type.name === "imageBlock") ids.push(parseImageBlockBody(String(node.attrs.raw ?? "")).id);
    return false;
  });
  return ids;
}

export type AddImagePolicy = {
  /** Most body images this article's type allows (0: none). */
  max: number;
  /** The text of a new, empty block with this id. */
  newBlock: (id: string) => string;
  /** Said when no image may be added, e.g. "A news article has no body images." */
  noneReason: string;
};

export function ArticleEditor({
  markdown,
  onChange,
  renderImageBlock,
  addImage,
  disabled = false,
  before,
  railHost,
  preview = false,
}: {
  /** Part of the article shown while the rest is still being prepared: no toolbar, nothing to edit, no space under it. */
  preview?: boolean;
  /**
   * Where the toolbar stands as a vertical bar on a wide screen: an element in
   * the page's empty left column, before the article box (build session,
   * 2026-10-15). Below that width the toolbar runs across the top of the box.
   */
  railHost?: HTMLElement | null;
  /** Shown above the article inside the box, under the toolbar (the cover). */
  before?: ReactNode;
  markdown: string;
  onChange: (markdown: string) => void;
  renderImageBlock?: BlockRender;
  addImage?: AddImagePolicy;
  disabled?: boolean;
}) {
  /* What the editor last said. A change of `markdown` that is not this came
     from elsewhere (a revision, a restored version, a new draft) and replaces
     the editor's content; one that is, is the editor's own typing coming back
     round and is left alone, so the cursor does not jump. */
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
    editable: !disabled,
    editorProps: {
      attributes: {
        class: "outline-none",
        "aria-label": "Article text",
        role: "textbox",
        "aria-multiline": "true",
      },
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

  useEffect(() => {
    // Without `false` this counts as an edit, and opening the page saved the draft.
    if (editor && editor.isEditable === disabled) editor.setEditable(!disabled, false);
  }, [editor, disabled]);

  return (
    <BlockRenderer.Provider value={renderImageBlock ?? null}>
      {editor && !preview && (
        <div className={railHost ? "lg:hidden" : undefined}>
          <Toolbar editor={editor} addImage={addImage} disabled={disabled} orientation="horizontal" />
        </div>
      )}
      {editor && railHost && !preview && createPortal(<Toolbar editor={editor} addImage={addImage} disabled={disabled} orientation="vertical" />, railHost)}
      {/* CENTRED, WITH THE SAME SPACE EACH SIDE (build session, 2026-10-15): a
          readable measure in the middle of the box on a wide screen, the box's
          own margin on a narrow one. The cover and the cards share it. The top
          matches the sides, so the cover drops its own top margin. */}
      <div
        className={`mx-auto w-full max-w-[46rem] px-5 pt-5 sm:px-8 sm:pt-8 [&>figure:first-of-type]:mt-0 ${preview ? "pb-0" : "pb-16 sm:pb-20"}`}
      >
        {before}
        <div className={`prose-draft prose-editor ${preview ? "prose-editor-preview" : ""}`} lang="en">
          <EditorContent editor={editor} />
        </div>
      </div>
    </BlockRenderer.Provider>
  );
}

function Toolbar({
  editor,
  addImage,
  disabled,
  orientation,
}: {
  editor: Editor;
  addImage?: AddImagePolicy;
  disabled: boolean;
  orientation: "horizontal" | "vertical";
}) {
  const vertical = orientation === "vertical";
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      paragraph: e.isActive("paragraph") && !e.isActive("bulletList") && !e.isActive("orderedList") && !e.isActive("blockquote"),
      h1: e.isActive("heading", { level: 1 }),
      h2: e.isActive("heading", { level: 2 }),
      h3: e.isActive("heading", { level: 3 }),
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      link: e.isActive("link"),
      bullet: e.isActive("bulletList"),
      ordered: e.isActive("orderedList"),
      quote: e.isActive("blockquote"),
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
      images: blockIds(e),
    }),
  });
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");

  const max = addImage?.max ?? 0;
  const freeId = nextFreeBlockId(state.images);
  const imageReason = !addImage
    ? "Images are not available here."
    : max === 0
      ? addImage.noneReason
      : state.images.length >= max || !freeId
        ? `This article can have at most ${max} body image${max === 1 ? "" : "s"}. Remove one to add another.`
        : undefined;

  function insertImage() {
    if (!addImage || !freeId || imageReason) return;
    const { $from } = editor.state.selection;
    // After the whole top-level block the cursor is in: never inside a sentence or a list.
    const at = $from.depth > 0 ? $from.after(1) : editor.state.doc.content.size;
    editor
      .chain()
      .focus()
      .insertContentAt(at, { type: "imageBlock", attrs: { raw: addImage.newBlock(freeId) } })
      .run();
  }

  function openLink() {
    setLinkUrl(String(editor.getAttributes("link").href ?? ""));
    setLinkOpen(true);
  }

  function applyLink() {
    const url = linkUrl.trim();
    const chain = editor.chain().focus().extendMarkRange("link");
    if (!url) chain.unsetLink().run();
    else chain.setLink({ href: /^https?:\/\//i.test(url) ? url : `https://${url}` }).run();
    setLinkOpen(false);
  }

  const button = (props: {
    label: string;
    icon: ReactNode;
    active?: boolean;
    onClick: () => void;
    disabled?: boolean;
    title?: string;
    text?: string;
  }) => (
    <button
      type="button"
      aria-label={props.label}
      title={props.title ?? props.label}
      aria-pressed={props.active}
      disabled={disabled || props.disabled}
      // Keep the article's selection: a click on the toolbar must not move the cursor.
      onMouseDown={(event) => event.preventDefault()}
      onClick={props.onClick}
      className={`inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg px-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)] disabled:cursor-not-allowed disabled:opacity-40 ${
        props.active ? "bg-chrome-active text-ink" : "text-ink-2 hover:bg-sunken hover:text-ink"
      } ${props.text ? "" : "w-9"}`}
    >
      {props.icon}
      {props.text && <span>{props.text}</span>}
    </button>
  );
  const divider = vertical ? (
    <span aria-hidden className="my-1 h-px w-5 shrink-0 bg-line" />
  ) : (
    <span aria-hidden className="mx-1 h-5 w-px shrink-0 bg-line" />
  );
  const icon = "size-4";
  const tag = "text-[13px] font-semibold leading-none tracking-tight";
  /* BESIDE THE LINK BUTTON, IN FRONT OF EVERYTHING (build session,
     2026-10-15: "it must show beside the link button and front most layer").
     On a wide screen it opens to the right of the button, over the article;
     across the top it opens under the toolbar. */
  const linkForm = linkOpen && (
    <form
      className={
        vertical
          ? "absolute left-full top-1/2 z-50 ml-3 flex w-96 -translate-y-1/2 items-center gap-2 rounded-2xl border border-line bg-surface p-2 shadow-[var(--shadow-pop)]"
          : "mt-1.5 flex items-center gap-2 pb-1"
      }
      onSubmit={(event) => {
        event.preventDefault();
        applyLink();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") setLinkOpen(false);
      }}
    >
      <label className="sr-only" htmlFor={`article-link-url-${orientation}`}>Link address</label>
      <input
        id={`article-link-url-${orientation}`}
        autoFocus
        value={linkUrl}
        onChange={(event) => setLinkUrl(event.target.value)}
        placeholder="Paste a link"
        title="Leave it empty and apply to remove the link"
        className="cs-input h-9 flex-1 text-sm"
      />
      <button type="submit" className="cs-btn h-9 px-3 text-sm">
        Apply
      </button>
      <button type="button" onClick={() => setLinkOpen(false)} className="cs-btn h-9 px-3 text-sm">
        Cancel
      </button>
    </form>
  );

  return (
    <div
      role="toolbar"
      aria-label="Format the article"
      aria-orientation={orientation}
      className={
        vertical
          ? /* A bar of its own beside the article, held in view while scrolling. */
            "sticky top-20 z-40 rounded-2xl border border-line bg-surface p-1.5 shadow-[var(--shadow-card)]"
          : /* Across the top of the box, inset from its rounded corner. */
            "sticky top-12 z-[5] rounded-t-2xl border-b border-line bg-surface/95 px-4 py-2.5 backdrop-blur-sm sm:px-6"
      }
    >
      <div className={vertical ? "flex flex-col items-center gap-0.5" : "flex items-center gap-0.5 overflow-x-auto"}>
        {/* IN THE ORDER OF THE HIERARCHY, H1 to P, each named by its plain tag
            (build session, 2026-10-15): the pilcrow and subscript icons were not
            understood. H1 is the title, so one deleted by accident can be typed
            again and made the title. */}
        {button({ label: "Title (H1)", icon: <span className={tag}>H1</span>, active: state.h1, onClick: () => editor.chain().focus().toggleHeading({ level: 1 }).run() })}
        {button({ label: "Section heading (H2)", icon: <span className={tag}>H2</span>, active: state.h2, onClick: () => editor.chain().focus().toggleHeading({ level: 2 }).run() })}
        {button({ label: "Sub-heading (H3)", icon: <span className={tag}>H3</span>, active: state.h3, onClick: () => editor.chain().focus().toggleHeading({ level: 3 }).run() })}
        {button({ label: "Paragraph (P)", icon: <span className={tag}>P</span>, active: state.paragraph, onClick: () => editor.chain().focus().setParagraph().run() })}
        {divider}
        {button({ label: "Bold", icon: <Bold aria-hidden className={icon} />, active: state.bold, onClick: () => editor.chain().focus().toggleBold().run() })}
        {button({ label: "Italic", icon: <Italic aria-hidden className={icon} />, active: state.italic, onClick: () => editor.chain().focus().toggleItalic().run() })}
        <span className="relative">
          {button({ label: "Link", icon: <Link2 aria-hidden className={icon} />, active: state.link || linkOpen, onClick: () => (linkOpen ? setLinkOpen(false) : openLink()) })}
          {vertical && linkForm}
        </span>
        {divider}
        {button({ label: "Bullet list", icon: <List aria-hidden className={icon} />, active: state.bullet, onClick: () => editor.chain().focus().toggleBulletList().run() })}
        {button({ label: "Numbered list", icon: <ListOrdered aria-hidden className={icon} />, active: state.ordered, onClick: () => editor.chain().focus().toggleOrderedList().run() })}
        {button({ label: "Quote", icon: <Quote aria-hidden className={icon} />, active: state.quote, onClick: () => editor.chain().focus().toggleBlockquote().run() })}
        {divider}
        {button({ label: "Undo", icon: <Undo2 aria-hidden className={icon} />, disabled: !state.canUndo, onClick: () => editor.chain().focus().undo().run() })}
        {button({ label: "Redo", icon: <Redo2 aria-hidden className={icon} />, disabled: !state.canRedo, onClick: () => editor.chain().focus().redo().run() })}
        {vertical ? divider : <span className="ml-auto pl-2" />}
        {button({
          label: "Add image",
          text: vertical ? undefined : "Add image",
          icon: <ImagePlus aria-hidden className={icon} />,
          disabled: Boolean(imageReason),
          title: imageReason ?? "Add an image slot after the paragraph the cursor is in",
          onClick: insertImage,
        })}
      </div>
      {!vertical && linkForm}
    </div>
  );
}
