import { useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChevronLeft, ChevronRight, RotateCcw, Check, X, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

const cards = [
  {
    topic: "DBMS",
    front: "What is the difference between a Candidate Key and a Primary Key?",
    back: "A candidate key is any minimal set of attributes that can uniquely identify a tuple. The primary key is the candidate key chosen by the DBA to uniquely identify rows; remaining candidates become alternate keys.",
  },
  {
    topic: "Operating Systems",
    front: "Define a deadlock and list its four necessary conditions.",
    back: "A deadlock occurs when processes wait indefinitely for resources held by each other. Conditions: Mutual Exclusion, Hold and Wait, No Preemption, and Circular Wait.",
  },
  {
    topic: "Computer Networks",
    front: "Why is TCP called connection-oriented while UDP is not?",
    back: "TCP establishes a session via a 3-way handshake (SYN, SYN-ACK, ACK), guarantees delivery and ordering. UDP is connectionless — it sends datagrams without setup, acknowledgement, or ordering.",
  },
];

const Flashcards = () => {
  const [idx, setIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const card = cards[idx];

  const next = () => { setFlipped(false); setTimeout(() => setIdx((idx + 1) % cards.length), 250); };
  const prev = () => { setFlipped(false); setTimeout(() => setIdx((idx - 1 + cards.length) % cards.length), 250); };

  return (
    <AppLayout>
      <div className="px-6 lg:px-10 py-8 max-w-3xl mx-auto space-y-8">
        <div className="text-center space-y-2">
          <div className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.25em] text-accent">
            <Sparkles className="h-3 w-3" /> Active Recall
          </div>
          <h1 className="font-serif text-4xl">Flashcards</h1>
          <p className="text-sm text-muted-foreground">Tap the card to reveal the answer.</p>
        </div>

        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>Card {idx + 1} of {cards.length}</span>
          <Badge variant="outline" className="border-accent/40 text-accent font-mono text-[10px]">
            {card.topic}
          </Badge>
        </div>

        {/* Flip card */}
        <div className="flip-card h-[420px] cursor-pointer" onClick={() => setFlipped(!flipped)}>
          <div className={cn("flip-inner relative h-full w-full", flipped && "flipped")}>
            {/* Front */}
            <div className="flip-face absolute inset-0 academic-card flex flex-col items-center justify-center p-10 text-center">
              <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-6">Question</span>
              <p className="font-serif text-3xl leading-snug text-foreground max-w-xl">{card.front}</p>
              <span className="absolute bottom-6 text-[11px] text-muted-foreground/70 italic">click to flip</span>
            </div>
            {/* Back */}
            <div className="flip-face flip-back absolute inset-0 academic-card border-accent/30 bg-gradient-hero flex flex-col items-center justify-center p-10 text-center">
              <span className="font-mono text-[10px] uppercase tracking-widest text-accent mb-6">Answer</span>
              <p className="text-base leading-relaxed text-foreground/90 max-w-xl">{card.back}</p>
            </div>
          </div>
        </div>

        {/* Controls */}
        <div className="flex items-center justify-between">
          <Button variant="outline" size="icon" onClick={prev} className="border-border hover:border-accent hover:text-accent">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="flex items-center gap-3">
            <Button variant="outline" size="sm" className="border-destructive/40 text-destructive hover:bg-destructive/10">
              <X className="mr-2 h-3.5 w-3.5" /> Hard
            </Button>
            <Button variant="outline" size="sm" onClick={() => setFlipped(false)} className="border-border">
              <RotateCcw className="mr-2 h-3.5 w-3.5" /> Reset
            </Button>
            <Button size="sm" className="bg-gradient-gold text-primary-foreground hover:opacity-90">
              <Check className="mr-2 h-3.5 w-3.5" /> Got it
            </Button>
          </div>
          <Button variant="outline" size="icon" onClick={next} className="border-border hover:border-accent hover:text-accent">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        {/* Deck progress */}
        <div className="flex items-center gap-1.5 justify-center pt-4">
          {cards.map((_, i) => (
            <div
              key={i}
              className={cn(
                "h-1 rounded-full transition-all",
                i === idx ? "w-8 bg-accent" : "w-2 bg-border"
              )}
            />
          ))}
        </div>
      </div>
    </AppLayout>
  );
};

export default Flashcards;
