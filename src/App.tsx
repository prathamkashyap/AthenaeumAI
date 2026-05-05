import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QuizProvider } from "@/context/QuizContext";
import Index from "./pages/Index.tsx";
import Quiz from "./pages/Quiz.tsx";
import Flashcards from "./pages/Flashcards.tsx";
import UploadPage from "./pages/Upload.tsx";
import Analytics from "./pages/Analytics.tsx";
import Assessments from "./pages/Assessments.tsx";
import CreateAssessment from "./pages/CreateAssessment.tsx";
import AttemptAssessment from "./pages/AttemptAssessment.tsx";
import ResultAssessment from "./pages/ResultAssessment.tsx";
import NotFound from "./pages/NotFound.tsx";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <QuizProvider>
          <Routes>
            <Route path="/" element={<Index />} />
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
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </QuizProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
