"use client";

import { useRef, useState } from "react";

type Props = {
  accept: string;
  title: string;
  description: string;
  fileTypes: string;
  processing: boolean;
  hasImage: boolean;
  onFiles: (files: FileList | null) => void;
};

export default function ImageUpload({
  accept,
  title,
  description,
  fileTypes,
  processing,
  hasImage,
  onFiles,
}: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  return (
    <>
      <input
        ref={input}
        type="file"
        accept={accept}
        aria-label={title}
        hidden
        disabled={processing}
        onChange={(event) => {
          onFiles(event.target.files);
          event.target.value = "";
        }}
      />
      <div
        className={`upload ${dragging ? "dragging" : ""} ${hasImage ? "has-image" : ""}`}
        onDragOver={(event) => {
          event.preventDefault();
          if (!processing) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          if (!processing) onFiles(event.dataTransfer.files);
        }}
      >
        <button
          className="upload-trigger"
          onClick={() => input.current?.click()}
          disabled={processing}
        >
          <span className="upload-art">
            <span className="photo-back" />
            <span className="photo-front">
              <svg viewBox="0 0 80 65" fill="none" aria-hidden="true">
                <rect
                  x="1"
                  y="1"
                  width="78"
                  height="63"
                  rx="8"
                  stroke="currentColor"
                  strokeWidth="2"
                />
                <circle cx="56" cy="19" r="7" fill="currentColor" />
                <path
                  d="m8 54 21-25 17 19 9-10 17 16"
                  stroke="currentColor"
                  strokeWidth="2"
                />
              </svg>
              <span className="upload-plus">+</span>
            </span>
          </span>
          <h3>{title}</h3>
          <p>
            {description} <u>browse files</u>
          </p>
          <span className="file-types">{fileTypes}</span>
        </button>
      </div>
    </>
  );
}
