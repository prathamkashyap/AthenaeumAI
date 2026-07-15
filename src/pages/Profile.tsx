import { AppLayout } from "@/components/AppLayout";
import { useAuth } from "@/context/AuthContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useState } from "react";
import { apiFetch } from "@/lib/api";
import { toast } from "sonner";
import { Flame, Award, Clock } from "lucide-react";

const Profile = () => {
  const { user } = useAuth();
  const [name, setName] = useState(user?.name || "");
  const [program, setProgram] = useState(user?.profile?.program || "");
  const [semester, setSemester] = useState(user?.profile?.semester || "");
  const [loading, setLoading] = useState(false);

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await apiFetch("/auth/profile", {
        method: "PUT",
        body: JSON.stringify({ name, program, semester }),
      });
      if (res.ok) {
        toast.success("Profile updated successfully!");
        // Typically, we would trigger a re-fetch of the /me endpoint in AuthContext here, 
        // but a reload or manual dispatch is sufficient for this v1.
        window.dispatchEvent(new Event("athenaeum-auth-updated"));
      } else {
        toast.error("Failed to update profile.");
      }
    } catch (err) {
      toast.error("Network error.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AppLayout>
      <div className="flex-1 space-y-6 p-6 lg:p-10 max-w-4xl mx-auto w-full">
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-serif font-semibold tracking-tight text-foreground">Profile & Settings</h1>
          <p className="text-muted-foreground">Manage your personal information, settings, and view achievements.</p>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          {/* Settings Form */}
          <Card className="border-border shadow-sm">
            <CardHeader>
              <CardTitle>Personal Information</CardTitle>
              <CardDescription>Update your academic profile and preferences.</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleUpdate} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input id="email" type="email" value={user?.email || ""} disabled className="bg-muted/50" />
                  <p className="text-xs text-muted-foreground">Email cannot be changed.</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="name">Full Name</Label>
                  <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="program">Program / Major</Label>
                    <Input id="program" value={program} onChange={(e) => setProgram(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="semester">Semester</Label>
                    <Input id="semester" value={semester} onChange={(e) => setSemester(e.target.value)} />
                  </div>
                </div>
                <Button type="submit" disabled={loading} className="w-full sm:w-auto">
                  {loading ? "Saving..." : "Save Changes"}
                </Button>
              </form>
            </CardContent>
          </Card>

          {/* Stats & Streaks */}
          <div className="space-y-6">
            <Card className="border-border shadow-sm bg-gradient-to-br from-card to-accent/10">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2">
                  <Flame className="h-5 w-5 text-orange-500" />
                  Learning Streak
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex justify-between items-end">
                  <div>
                    <p className="text-4xl font-bold text-foreground">{user?.streak?.current || 0} <span className="text-lg text-muted-foreground font-normal">days</span></p>
                    <p className="text-sm text-muted-foreground mt-1">Current active streak</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xl font-semibold text-foreground">{user?.streak?.longest || 0}</p>
                    <p className="text-sm text-muted-foreground">Longest streak</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-border shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2">
                  <Award className="h-5 w-5 text-yellow-500" />
                  Recent Achievements
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4 pt-2">
                  <div className="flex items-start gap-4">
                    <div className="bg-primary/10 p-2 rounded-full">
                      <Clock className="h-4 w-4 text-primary" />
                    </div>
                    <div>
                      <p className="font-medium text-sm">First Quiz Completed</p>
                      <p className="text-xs text-muted-foreground">You completed your first diagnostic assessment.</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-4">
                    <div className="bg-primary/10 p-2 rounded-full">
                      <Flame className="h-4 w-4 text-primary" />
                    </div>
                    <div>
                      <p className="font-medium text-sm">3 Day Streak</p>
                      <p className="text-xs text-muted-foreground">You studied for 3 consecutive days.</p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </AppLayout>
  );
};

export default Profile;
