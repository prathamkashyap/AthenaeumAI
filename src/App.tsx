import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AuthProvider } from "@/context/AuthContext";
import { QuizProvider } from "@/context/QuizContext";
import { lazy, Suspense } from "react";
import Auth from "./pages/Auth.tsx";
import Index from "./pages/Index.tsx";
import NotFound from "./pages/NotFound.tsx";
import { Loader2 } from "lucide-react";

// Lazy-loaded routes for better initial load performance
const Quiz = lazy(() => import("./pages/Quiz.tsx"));
const Flashcards = lazy(() => import("./pages/Flashcards.tsx"));
const UploadPage = lazy(() => import("./pages/Upload.tsx"));
const Analytics = lazy(() => import("./pages/Analytics.tsx"));
const Assessments = lazy(() => import("./pages/Assessments.tsx"));
const CreateAssessment = lazy(() => import("./pages/CreateAssessment.tsx"));
const AttemptAssessment = lazy(() => import("./pages/AttemptAssessment.tsx"));
const ResultAssessment = lazy(() => import("./pages/ResultAssessment.tsx"));
const Tutor = lazy(() => import("./pages/Tutor.tsx"));
const Profile = lazy(() => import("./pages/Profile.tsx"));

const SuspenseFallback = () => (
  <div className="flex-1 flex items-center justify-center min-h-screen bg-background">
    <Loader2 className="h-8 w-8 animate-spin text-accent" />
  </div>
);

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <QuizProvider>
            <Routes>
              <Route path="/auth" element={<Auth />} />
              <Route element={<ProtectedRoute />}>
                <Route path="/" element={<Index />} />
                <Route path="/*" element={
                  <Suspense fallback={<SuspenseFallback />}>
                    <Routes>
                      <Route path="/library" element={<UploadPage />} />
                      <Route path="/upload" element={<UploadPage />} />
                      <Route path="/assessments" element={<Assessments />} />
                      <Route path="/assessments/create" element={<CreateAssessment />} />
                      <Route path="/assessments/:id" element={<AttemptAssessment />} />
                      <Route path="/assessments/:id/result" element={<ResultAssessment />} />
                      <Route path="/practice" element={<Flashcards />} />
                      <Route path="/flashcards" element={<Flashcards />} />
                      <Route path="/question-bank" element={<Quiz />} />
                      <Route path="/quiz" element={<Quiz />} />
                      <Route path="/analytics" element={<Analytics />} />
                      <Route path="/tutor" element={<Tutor />} />
                      <Route path="/profile" element={<Profile />} />
                      <Route path="*" element={<NotFound />} />
                    </Routes>
                  </Suspense>
                } />
              </Route>
              <Route path="*" element={<NotFound />} />
            </Routes>
          </QuizProvider>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
