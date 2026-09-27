"use client";

import { ArrowRight, BookOpenCheck, ChevronRight } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export default function JoinClass() {
  const [code, setCode] = useState("");
  const router = useRouter();

  useEffect(() => {
    document.documentElement.dataset.theme = localStorage.getItem("classkit-dark-mode") === "true" ? "dark" : "light";
  }, []);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleaned = code.replace(/[^a-z0-9]/gi, "").toUpperCase();
    if (cleaned) router.push(`/s/${cleaned}`);
  }

  return <main className="student-page">
    <header className="student-top"><Link className="student-brand" href="/"><span className="brand-mark"><BookOpenCheck size={18} /></span> classkit</Link><Link className="teacher-link" href="/">I’m a teacher <ChevronRight size={14} /></Link></header>
    <section className="join-card">
      <span className="student-deco"><BookOpenCheck size={24} /></span>
      <div className="eyebrow">A LITTLE PRACTICE GOES A LONG WAY</div>
      <h1>Ready when<br />you are.</h1>
      <p>Enter the class code your teacher shared. No account, no fuss — just you and a few good questions.</p>
      <form onSubmit={submit}>
        <label className="field"><span>Your class code</span><input autoFocus value={code} onChange={(event) => setCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12))} placeholder="e.g. M8K4Q2" autoCapitalize="characters" autoComplete="off" /></label>
        <button className="button button-primary full" type="submit" disabled={!code.trim()}>Let’s go <ArrowRight size={16} /></button>
      </form>
      <span className="student-reassurance">Your teacher will see your name and how you did.</span>
    </section>
    <footer className="student-footer">Made for curious minds <span>✳</span></footer>
  </main>;
}
