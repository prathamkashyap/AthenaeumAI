import { AuroraBackground } from "@/components/AuroraBackground";
import { BrandLockup, BRAND } from "@/components/BrandLockup";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useAuth } from "@/context/AuthContext";
import { cn } from "@/lib/utils";
import {
  AI_BOUNDARY,
  CAPABILITIES,
  FAQ,
  LEARNING_LOOP,
  PROOF,
  STACK,
  WORKSPACE_SURFACES,
} from "@/lib/landingCopy";
import {
  ArrowRight,
  BarChart3,
  Brain,
  CalendarCheck,
  Check,
  Layers,
  Library,
  Loader2,
  Minus,
  Trophy,
} from "lucide-react";
import { Link, Navigate } from "react-router-dom";

const CAPABILITY_ICONS = { Library, Brain, BarChart3, CalendarCheck, Trophy, Layers } as const;

/**
 * The header carries short labels; the footer keeps the full wording. Measured at
 * 768px the five-item nav plus the lockup and the CTA needed ~836px, so the row
 * overflowed by 68px — `md:flex` was switching the nav on far too early.
 */
const NAV = [
  { href: "#loop", label: "How it works", long: "How it works" },
  { href: "#capabilities", label: "Capabilities", long: "Capabilities" },
  { href: "#stack", label: "Stack", long: "Under the hood" },
  { href: "#boundary", label: "Limits", long: "What it does not do" },
  { href: "#faq", label: "FAQ", long: "FAQ" },
];

function SectionHeading({ eyebrow, title, lede }: { eyebrow: string; title: string; lede?: string }) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <p className="text-[10px] uppercase tracking-[0.25em] text-accent">{eyebrow}</p>
      <h2 className="mt-3 font-serif text-3xl leading-tight text-foreground sm:text-4xl">{title}</h2>
      {lede && <p className="mt-4 text-base leading-relaxed text-muted-foreground">{lede}</p>}
    </div>
  );
}

const Landing = () => {
  const { isAuthenticated, isLoading } = useAuth();

  // The domain root is the public face, so a signed-in member should never see it.
  // `isLoading` is checked first for the same reason ProtectedRoute checks it:
  // deciding before the stored token has been read would flash the marketing page
  // at someone who is already signed in.
  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-accent" />
      </div>
    );
  }

  if (isAuthenticated) return <Navigate to="/dashboard" replace />;

  return (
    <div className="relative min-h-screen bg-background text-foreground">
      <AuroraBackground />

      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-accent focus:px-4 focus:py-2 focus:text-accent-foreground"
      >
        Skip to content
      </a>

      <div className="relative z-10">
        {/* ---------------- header ---------------- */}
        <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur">
          <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 sm:gap-6 sm:px-6">
            {/* `min-w-0` so the lockup can yield space rather than push the CTA
                off-screen if the brand strings ever get longer. */}
            <Link
              to="/"
              className="min-w-0 shrink"
              aria-label={`${BRAND.fullName} home`}
            >
              {/* The tagline is ~180px of the row and the least essential part of
                  the lockup, so it is the first thing to go when space is tight. */}
              <BrandLockup size="sm" taglineClassName="hidden lg:block" />
            </Link>

            <nav aria-label="Primary" className="hidden items-center gap-6 lg:flex xl:gap-7">
              {NAV.map((item) => (
                <a
                  key={item.href}
                  href={item.href}
                  className="whitespace-nowrap text-sm text-muted-foreground transition-colors hover:text-foreground"
                >
                  {item.label}
                </a>
              ))}
            </nav>

            <Button asChild size="sm" className="shrink-0 bg-gradient-brand text-primary-foreground">
              <Link to="/auth">
                Open workspace
                <ArrowRight className="ml-2 hidden h-4 w-4 sm:block" />
              </Link>
            </Button>
          </div>
        </header>

        <main id="main">
          {/* ---------------- hero ---------------- */}
          <section className="mx-auto max-w-6xl px-6 pb-20 pt-20 text-center sm:pt-28">
            <Badge
              variant="outline"
              className="border-accent/30 bg-accent/10 text-accent hover:bg-accent/10"
            >
              Adaptive mastery from your own material
            </Badge>

            <h1 className="mx-auto mt-6 max-w-3xl font-serif text-5xl leading-[1.06] sm:text-6xl">
              Turn a syllabus into a mastery you can prove.
            </h1>

            <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground">
              {BRAND.fullName} reads the material you upload, writes exam-style questions from it,
              and then keeps track of what you actually got wrong — so revision is scheduled by
              evidence instead of intention.
            </p>

            <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Button asChild size="lg" className="w-full bg-gradient-brand text-primary-foreground sm:w-auto">
                <Link to="/auth">
                  Start with your material
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="w-full sm:w-auto">
                <a href="#loop">See how it works</a>
              </Button>
            </div>

            <dl className="mx-auto mt-16 grid max-w-3xl grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-4">
              {[
                { k: "Material", v: "PDF upload" },
                { k: "Questions", v: "Grounded in your text" },
                { k: "Progress", v: "From stored attempts" },
                { k: "Running cost", v: "Free tiers only" },
              ].map((stat) => (
                <div key={stat.k} className="bg-background px-4 py-5">
                  <dt className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                    {stat.k}
                  </dt>
                  <dd className="mt-1.5 text-sm text-foreground">{stat.v}</dd>
                </div>
              ))}
            </dl>
          </section>

          {/* ---------------- the five-stage loop ---------------- */}
          <section id="loop" className="scroll-mt-20 border-t border-border/60 py-20">
            <div className="mx-auto max-w-6xl px-6">
              <SectionHeading
                eyebrow="The loop"
                title="Five stages, and each one is real"
                lede="Every stage below corresponds to working code and stored data. This is the whole product — there is no sixth step and nothing waiting on a roadmap."
              />

              <ol className="mt-14 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {LEARNING_LOOP.map((stage) => (
                  <li key={stage.step}>
                    <Card className="h-full border-border/60 bg-card/60">
                      <CardContent className="p-6">
                        <div className="flex items-center gap-3">
                          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent/12 font-mono text-xs text-accent">
                            {stage.step}
                          </span>
                          <h3 className="font-serif text-lg leading-snug">{stage.title}</h3>
                        </div>
                        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                          {stage.body}
                        </p>
                        <p className="mt-4 font-mono text-[10px] uppercase tracking-wider text-muted-foreground/70">
                          {stage.backing}
                        </p>
                      </CardContent>
                    </Card>
                  </li>
                ))}

                {/* The loop closes here, so state it rather than implying it. */}
                <li className="flex items-center">
                  <div className="w-full rounded-lg border border-accent/25 bg-accent/5 p-6">
                    <p className="text-[10px] uppercase tracking-[0.2em] text-accent">
                      And then it repeats
                    </p>
                    <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                      Stage five feeds stage one. Weak topics produce the next upload, the next
                      assessment, and the next measurable result.
                    </p>
                  </div>
                </li>
              </ol>
            </div>
          </section>

          {/* ---------------- capabilities ---------------- */}
          <section id="capabilities" className="scroll-mt-20 border-t border-border/60 py-20">
            <div className="mx-auto max-w-6xl px-6">
              <SectionHeading
                eyebrow="Capabilities"
                title="What you get once you are inside"
                lede="Six surfaces, each backed by the endpoints that serve it."
              />

              <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {CAPABILITIES.map((cap) => {
                  const Icon = CAPABILITY_ICONS[cap.icon as keyof typeof CAPABILITY_ICONS] ?? Layers;
                  return (
                    <Card key={cap.title} className="border-border/60 bg-card/60">
                      <CardContent className="p-6">
                        <div className="flex h-9 w-9 items-center justify-center rounded-md bg-accent/10 text-accent">
                          <Icon className="h-4 w-4" />
                        </div>
                        <h3 className="mt-4 font-serif text-lg">{cap.title}</h3>
                        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                          {cap.body}
                        </p>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </div>
          </section>

          {/* ---------------- under the hood ---------------- */}
          <section id="stack" className="scroll-mt-20 border-t border-border/60 py-20">
            <div className="mx-auto max-w-6xl px-6">
              <SectionHeading
                eyebrow="Under the hood"
                title="Boring infrastructure, on purpose"
                lede="Nothing here needs a paid plan, so the project can stay up without a credit card attached to it."
              />

              <dl className="mt-14 grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2">
                {STACK.map((item) => (
                  <div key={item.label} className="bg-background p-6">
                    <dt className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                      {item.label}
                    </dt>
                    <dd className="mt-2 font-serif text-xl">{item.value}</dd>
                    <dd className="mt-2 text-sm leading-relaxed text-muted-foreground">{item.why}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </section>

          {/* ---------------- inside the workspace ---------------- */}
          <section className="scroll-mt-20 border-t border-border/60 py-20">
            <div className="mx-auto max-w-6xl px-6">
              <SectionHeading
                eyebrow="Inside"
                title="Six places you will spend your time"
                lede="Named exactly as the sidebar names them, so nothing is renamed between this page and the product."
              />

              <ul className="mt-14 grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2 lg:grid-cols-3">
                {WORKSPACE_SURFACES.map((surface) => (
                  <li key={surface.name} className="bg-background p-6">
                    <p className="font-serif text-lg">{surface.name}</p>
                    <p className="mt-1.5 text-sm text-muted-foreground">{surface.purpose}</p>
                  </li>
                ))}
              </ul>
            </div>
          </section>

          {/* ---------------- proof ---------------- */}
          <section className="scroll-mt-20 border-t border-border/60 py-20">
            <div className="mx-auto max-w-6xl px-6">
              <SectionHeading
                eyebrow="Verification"
                title="Checked on every commit"
                lede="These are the counts from the suite that runs on each change to main, not an estimate."
              />

              <dl className="mt-14 grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
                {[
                  { k: "Backend unit", v: PROOF.backendUnit },
                  { k: "Backend integration", v: PROOF.backendIntegration },
                  { k: "Frontend", v: PROOF.frontend },
                  { k: "Browser end-to-end", v: PROOF.endToEnd },
                ].map((row) => (
                  <div key={row.k} className="bg-background px-6 py-8 text-center">
                    <dd className="font-serif text-4xl tabular-nums">{row.v}</dd>
                    <dt className="mt-2 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                      {row.k}
                    </dt>
                  </div>
                ))}
              </dl>

              <p className="mx-auto mt-6 max-w-2xl text-center text-sm text-muted-foreground">
                Typecheck, build and lint run in the same pipeline. A pull request cannot reach
                main on a red suite.
              </p>
            </div>
          </section>

          {/* ---------------- AI boundary ---------------- */}
          <section id="boundary" className="scroll-mt-20 border-t border-border/60 py-20">
            <div className="mx-auto max-w-4xl px-6">
              <SectionHeading
                eyebrow="The honest part"
                title="What it does, and what it does not"
                lede="Most products in this category blur the line between a language model and an assessment. This page does not, because the product does not."
              />

              <ul className="mt-14 space-y-3">
                {AI_BOUNDARY.map((row) => (
                  <li
                    key={row.does}
                    className="grid gap-3 rounded-lg border border-border/60 bg-card/40 p-5 sm:grid-cols-2 sm:gap-6"
                  >
                    <p className="flex gap-2.5 text-sm leading-relaxed">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden />
                      <span>{row.does}</span>
                    </p>
                    <p className="flex gap-2.5 text-sm leading-relaxed">
                      <Minus className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/60" aria-hidden />
                      <span className="text-muted-foreground">{row.doesNot}</span>
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          </section>

          {/* ---------------- FAQ ---------------- */}
          <section id="faq" className="scroll-mt-20 border-t border-border/60 py-20">
            <div className="mx-auto max-w-3xl px-6">
              <SectionHeading eyebrow="FAQ" title="Reasonable questions" />

              <Accordion type="single" collapsible className="mt-12">
                {FAQ.map((entry) => (
                  <AccordionItem key={entry.question} value={entry.question}>
                    <AccordionTrigger className="text-left font-serif text-base">
                      {entry.question}
                    </AccordionTrigger>
                    <AccordionContent className="text-sm leading-relaxed text-muted-foreground">
                      {entry.answer}
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </div>
          </section>

          {/* ---------------- closing CTA ---------------- */}
          <section className="border-t border-border/60 py-20">
            <div className="mx-auto max-w-2xl px-6 text-center">
              <h2 className="font-serif text-3xl">Start with one document</h2>
              <p className="mt-3 text-muted-foreground">
                Upload a chapter and the loop starts working immediately.
              </p>
              <Button asChild size="lg" className="mt-8 bg-gradient-brand text-primary-foreground">
                <Link to="/auth">
                  Open the workspace
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            </div>
          </section>
        </main>

        {/* ---------------- footer ---------------- */}
        <footer className="border-t border-border/60 py-10">
          <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-6 px-6 sm:flex-row">
            <Link to="/" className="shrink-0" aria-label={`${BRAND.fullName} home`}>
              <BrandLockup size="sm" />
            </Link>
            <nav aria-label="Footer" className="flex flex-wrap items-center justify-center gap-6">
              {NAV.map((item) => (
                <a
                  key={item.href}
                  href={item.href}
                  className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                >
                  {item.long}
                </a>
              ))}
            </nav>
            <p className="text-xs text-muted-foreground">
              Generation by Groq. Progress measured from your own attempts.
            </p>
          </div>
        </footer>
      </div>
    </div>
  );
};

export default Landing;
