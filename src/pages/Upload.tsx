import { useState, useRef } from "react";
import { AppLayout } from "@/components/AppLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { UploadCloud, FileText, Sparkles, MoreHorizontal, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

const uploaded = [
  { name: "Operating Systems – Galvin Ch. 9-12.pdf", size: "4.2 MB", pages: 142, status: "Indexed", topic: "OS" },
  { name: "DBMS_Korth_Notes.pdf", size: "2.8 MB", pages: 96, status: "Indexed", topic: "DBMS" },
  { name: "NPTEL_ML_2024_Lectures.pdf", size: "9.1 MB", pages: 318, status: "Processing", topic: "ML" },
];

const UploadPage = () => {
  const [drag, setDrag] = useState(false);
  const ref = useRef<HTMLInputElement>(null);

  return (
    <AppLayout>
      <div className="px-6 lg:px-10 py-8 max-w-5xl mx-auto space-y-8">
        <div>
          <h1 className="font-serif text-4xl">Library</h1>
          <p className="text-sm text-muted-foreground mt-2">
            Upload PDFs of textbooks, notes, or NPTEL transcripts. The model will index, summarise, and generate quizzes from them.
          </p>
        </div>

        {/* Dropzone */}
        <div
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); }}
          onClick={() => ref.current?.click()}
          className={cn(
            "relative rounded-2xl border-2 border-dashed p-16 text-center cursor-pointer transition-all duration-300 group overflow-hidden",
            drag ? "border-accent bg-accent/5" : "border-border bg-card/30 hover:border-accent/60 hover:bg-card/60"
          )}
        >
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,hsl(var(--accent)/0.10),transparent_60%)] opacity-0 group-hover:opacity-100 transition-opacity" />
          <input ref={ref} type="file" accept=".pdf" className="hidden" multiple />
          <div className="relative flex flex-col items-center gap-4">
            <div className="h-16 w-16 rounded-full bg-muted/40 border border-border flex items-center justify-center group-hover:scale-110 group-hover:border-accent/60 transition-all">
              <UploadCloud className="h-7 w-7 text-accent" />
            </div>
            <div>
              <p className="font-serif text-2xl text-foreground">Drop your PDFs here</p>
              <p className="text-sm text-muted-foreground mt-1">or click to browse · max 50 MB per file</p>
            </div>
            <div className="flex items-center gap-2 mt-2">
              <Badge variant="outline" className="border-border text-[10px] font-mono">PDF</Badge>
              <Badge variant="outline" className="border-border text-[10px] font-mono">EPUB</Badge>
              <Badge variant="outline" className="border-border text-[10px] font-mono">DOCX</Badge>
            </div>
          </div>
        </div>

        {/* AI options */}
        <Card className="academic-card p-6">
          <div className="flex items-start gap-4">
            <Sparkles className="h-5 w-5 text-accent shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-semibold">After upload, the AI will…</p>
              <div className="mt-3 grid sm:grid-cols-3 gap-3 text-sm text-muted-foreground">
                <div className="flex items-start gap-2"><CheckCircle2 className="h-4 w-4 text-accent mt-0.5" /> Generate MCQs & fill-blanks</div>
                <div className="flex items-start gap-2"><CheckCircle2 className="h-4 w-4 text-accent mt-0.5" /> Build flashcard decks</div>
                <div className="flex items-start gap-2"><CheckCircle2 className="h-4 w-4 text-accent mt-0.5" /> Detect chapters & topics</div>
              </div>
            </div>
          </div>
        </Card>

        {/* List */}
        <div className="space-y-3">
          <h2 className="font-serif text-2xl">Your Library</h2>
          {uploaded.map((f) => (
            <Card key={f.name} className="academic-card p-4 flex items-center gap-4">
              <div className="h-11 w-11 rounded-md bg-muted/50 border border-border flex items-center justify-center shrink-0">
                <FileText className="h-5 w-5 text-accent" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{f.name}</p>
                <p className="text-xs text-muted-foreground mt-0.5 font-mono">
                  {f.pages} pages · {f.size} · <span className="text-accent">{f.topic}</span>
                </p>
              </div>
              <Badge
                variant="outline"
                className={cn(
                  "text-[10px] font-mono",
                  f.status === "Indexed" ? "border-emerald-700/40 text-emerald-400" : "border-accent/40 text-accent animate-pulse"
                )}
              >
                {f.status}
              </Badge>
              <Button variant="ghost" size="icon">
                <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
              </Button>
            </Card>
          ))}
        </div>
      </div>
    </AppLayout>
  );
};

export default UploadPage;
