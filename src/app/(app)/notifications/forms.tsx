"use client";
import { ActionForm, SubmitButton } from "@/components/form";
import { markAllReadAction } from "./actions";

export function MarkAllRead() {
  return (
    <ActionForm action={markAllReadAction}>
      <SubmitButton variant="secondary">すべて既読にする</SubmitButton>
    </ActionForm>
  );
}
