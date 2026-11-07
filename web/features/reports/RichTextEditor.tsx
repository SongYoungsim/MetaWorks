import { Color } from "@tiptap/extension-color";
import { Placeholder } from "@tiptap/extension-placeholder";
import { TextStyle } from "@tiptap/extension-text-style";
import Image from "@tiptap/extension-image";
import { EditorContent, useEditor, type JSONContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Bold, ImagePlus, List, LoaderCircle, Redo2, Undo2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { apiRequest } from "@/lib/api";

interface RichValue {
  json: JSONContent | null;
  text: string;
}

function readContent(value: string | null, fallbackText: string | null): JSONContent | string {
  if (value) {
    try {
      return JSON.parse(value) as JSONContent;
    } catch {
      // 과거 평문 데이터는 아래 fallback으로 표시한다.
    }
  }
  return fallbackText ?? "";
}

export function RichTextEditor({
  value,
  fallbackText,
  placeholder,
  entryId,
  uploadOwner,
  onChange,
}: {
  value: string | null;
  fallbackText: string | null;
  placeholder: string;
  entryId?: number;
  uploadOwner?: { type: "entry" | "meeting"; id: number } | null;
  onChange: (value: RichValue) => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit,
      TextStyle,
      Color.configure({ types: ["textStyle"] }),
      Placeholder.configure({ placeholder }),
      Image.configure({ allowBase64: false, inline: false }),
    ],
    content: readContent(value, fallbackText),
    editorProps: { attributes: { class: "report-editor-content" } },
    onUpdate: ({ editor: current }) => onChange({
      json: current.isEmpty ? null : current.getJSON(),
      text: current.getText(),
    }),
  });

  useEffect(() => () => editor?.destroy(), [editor]);
  if (!editor) return <div className="report-editor-loading">편집기 준비 중…</div>;

  const uploadImage = async (file: File) => {
    if (!file.type.startsWith("image/") || uploading) return;
    const owner = uploadOwner ?? (entryId ? { type: "entry" as const, id: entryId } : null);
    if (!owner) {
      setUploadError("이미지를 첨부하려면 먼저 임시저장하세요.");
      return;
    }
    setUploading(true);
    setUploadError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("ownerType", owner.type);
      form.append("ownerId", String(owner.id));
      const result = await apiRequest<{ url: string; fileName: string }>("/api/files/images", {
        method: "POST", body: form,
      });
      editor.chain().focus().setImage({ src: result.url, alt: result.fileName }).run();
    } catch (reason) {
      setUploadError(reason instanceof Error ? reason.message : "이미지를 첨부하지 못했습니다.");
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const toolbarButton = (label: string, active: boolean, onClick: () => void, icon: React.ReactNode) =>
    <button type="button" aria-label={label} title={label} className={active ? "is-active" : ""}
      onClick={onClick}>{icon}</button>;

  return <div className="report-editor">
    <div className="report-editor-toolbar">
      {toolbarButton("굵게", editor.isActive("bold"),
        () => editor.chain().focus().toggleBold().run(), <Bold />)}
      {toolbarButton("글머리 목록", editor.isActive("bulletList"),
        () => editor.chain().focus().toggleBulletList().run(), <List />)}
      <button type="button" aria-label="이미지 첨부" title="이미지 첨부 또는 Ctrl+V 붙여넣기"
        disabled={uploading} onClick={() => fileInput.current?.click()}>
        {uploading ? <LoaderCircle className="is-spinning" /> : <ImagePlus />}
      </button>
      <input ref={fileInput} className="sr-only" type="file" accept="image/png,image/jpeg,image/gif,image/webp"
        onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadImage(file); }} />
      <span className="report-editor-divider" />
      {[{ label: "검정", color: "#18181b" }, { label: "빨강", color: "#dc2626" },
        { label: "파랑", color: "#2563eb" }].map((item) =>
        <button type="button" key={item.color} className="report-color-button"
          aria-label={item.label + " 글씨"} title={item.label + " 글씨"}
          onClick={() => editor.chain().focus().setColor(item.color).run()}>
          <i style={{ backgroundColor: item.color }} />
        </button>)}
      <span className="report-editor-divider" />
      {toolbarButton("실행 취소", false, () => editor.chain().focus().undo().run(), <Undo2 />)}
      {toolbarButton("다시 실행", false, () => editor.chain().focus().redo().run(), <Redo2 />)}
    </div>
    <div onPasteCapture={(event) => {
      const file = Array.from(event.clipboardData.files).find((item) => item.type.startsWith("image/"));
      if (file) { event.preventDefault(); void uploadImage(file); }
    }}><EditorContent editor={editor} /></div>
    {uploadError && <p className="report-editor-error">{uploadError}</p>}
  </div>;
}
