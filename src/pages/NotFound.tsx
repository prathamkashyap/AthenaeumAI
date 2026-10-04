import { useLocation } from "react-router-dom";
import { useEffect } from "react";
import { Link } from "react-router-dom";
import { BrandLockup } from "@/components/BrandLockup";
import { Button } from "@/components/ui/button";

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background px-6 text-center text-foreground">
      <BrandLockup size="md" markOnly />
      <div>
        {/* Themed, not the old hardcoded `text-4xl font-bold` in `text-primary`
            on `bg-muted`, which ignored the light/dark tokens entirely. */}
        <p className="font-serif text-6xl leading-none text-accent">404</p>
        <h1 className="mt-3 font-serif text-2xl">This page does not exist</h1>
        <p className="mt-2 max-w-md text-sm text-muted-foreground">
          The address you followed is not part of Athenaeum. Check the link, or head back to the
          start.
        </p>
      </div>
      {/* Was a raw <a href="/">, which threw away the router and forced a full
          document reload. "/" is now the public landing page, so this should be a
          client-side navigation. */}
      <Button asChild>
        <Link to="/">Back to home</Link>
      </Button>
    </div>
  );
};

export default NotFound;
