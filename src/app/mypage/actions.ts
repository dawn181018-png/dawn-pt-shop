"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function logoutMember() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/mypage/login");
}
