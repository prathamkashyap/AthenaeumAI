import { useEffect, useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { FileText, Sparkles, CheckCircle2, Search, BookOpen, Layers, Loader2, Plus } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { Link } from "react-router-dom";

interface Material {
  _id: string;
  title: string;
  originalFileName: string;
  sizeBytes: number;
  tags: string[];
  textPreview: string;
  linkedQuizzes?: { _id: string; title: string; questionCount: number }[];
  linkedFlashcardSets?: { _id: string; title: string; cards: unknown[] }[];
  createdAt: string;
}

const UploadPage = () => {
  const [materials, setMaterials] = useState<Material[]>([]);
  const [search, setSearch] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setIsLoading(true);
      apiFetch(`/library${search ? `?search=${encodeURIComponent(search)}` : ""}`)
        .then((response) => response.ok ? response.json() : Promise.reject())
        .then((data) => setMaterials(data.materials || []))
        .catch(() => setMaterials([]))
        .finally(() => setIsLoading(false));
    }, 180);

    return () => window.clearTimeout(timeout);
  }, [search]);

  const formatSize = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(2)} MB`;

  return (
    <AppLayout>
      <div className="px-6 lg:px-10 py-8 max-w-6xl mx-auto space-y-8">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
          <div>
            <h1 className="font-serif text-4xl">Library</h1>
            <p className="text-sm text-muted-foreground mt-2">
              Persistent source material linked to generated assessments, flashcards, and progress.
            </p>
          </div>
          <Button asChild className="bg-accent text-primary-foreground hover:bg-accent/90">
            <Link to="/assessments/create"><Plus className="mr-2 h-4 w-4" /> Add Material</Link>
          </Button>
        </div>

        <Card className="academic-card p-6">
          <div className="flex items-start gap-4">
            <Sparkles className="h-5 w-5 text-accent shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-semibold">Library workflow</p>
              <div className="mt-3 grid sm:grid-cols-3 gap-3 text-sm text-muted-foreground">
                <div className="flex items-start gap-2"><CheckCircle2 className="h-4 w-4 text-accent mt-0.5" /> PDF text is retained for reuse</div>
                <div className="flex items-start gap-2"><CheckCircle2 className="h-4 w-4 text-accent mt-0.5" /> Quizzes stay linked to sources</div>
                <div className="flex items-start gap-2"><CheckCircle2 className="h-4 w-4 text-accent mt-0.5" /> Flashcards can target weak topics</div>
              </div>
            </div>
          </div>
        </Card>

        <div className="flex items-center justify-between gap-4">
          <h2 className="font-serif text-2xl">Your Materials</h2>
          <div className="relative w-full max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search titles, tags, text..."
              className="pl-9 bg-muted/40"
            />
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-accent" />
          </div>
        ) : materials.length ? (
          <div className="grid gap-4">
            {materials.map((material) => (
              <Card key={material._id} className="academic-card p-5">
                <div className="flex flex-col lg:flex-row lg:items-start gap-4">
                  <div className="h-12 w-12 rounded-md bg-accent/10 border border-accent/20 flex items-center justify-center shrink-0">
                    <FileText className="h-5 w-5 text-accent" />
                  </div>
                  <div className="flex-1 min-w-0 space-y-3">
                    <div>
                      <p className="text-sm font-medium truncate">{material.title}</p>
                      <p className="text-xs text-muted-foreground mt-0.5 font-mono">
                        {material.originalFileName} · {formatSize(material.sizeBytes)}
                      </p>
                    </div>
                    <p className="text-xs text-muted-foreground line-clamp-2">{material.textPreview}</p>
                    <div className="flex flex-wrap gap-2">
                      {(material.tags.length ? material.tags : ["untagged"]).map((tag) => (
                        <Badge key={tag} variant="outline" className="border-border text-[10px] font-mono">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  <div className="flex lg:flex-col gap-2 lg:w-40">
                    <Badge variant="outline" className="border-accent/40 text-accent justify-center">
                      <BookOpen className="mr-1.5 h-3 w-3" />
                      {material.linkedQuizzes?.length || 0} quizzes
                    </Badge>
                    <Badge variant="outline" className="border-cyan-500/30 text-cyan-300 justify-center">
                      <Layers className="mr-1.5 h-3 w-3" />
                      {material.linkedFlashcardSets?.length || 0} decks
                    </Badge>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        ) : (
          <Card className="academic-card p-10 text-center">
            <div className="mx-auto h-14 w-14 rounded-xl bg-accent/10 border border-accent/20 flex items-center justify-center mb-4">
              <FileText className="h-7 w-7 text-accent" />
            </div>
            <h3 className="font-serif text-2xl">No materials indexed yet</h3>
            <p className="text-sm text-muted-foreground mt-2 max-w-md mx-auto">
              Generate an assessment from a PDF and AthenaeumAI will save the source into your persistent library.
            </p>
            <Button asChild className="mt-5 bg-accent text-primary-foreground hover:bg-accent/90">
              <Link to="/assessments/create">Upload and Generate</Link>
            </Button>
          </Card>
        )}
      </div>
    </AppLayout>
  );
};

export default UploadPage;
