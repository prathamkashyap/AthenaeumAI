import { z } from "zod";

export const signupSchema = {
  body: z.object({
    name: z.string({
      required_error: "Name is required.",
    }).trim().min(1, "Name cannot be empty.").max(100, "Name must be under 100 characters."),
    
    email: z.string({
      required_error: "Email is required.",
    }).trim().email("Please provide a valid email address."),
    
    password: z.string({
      required_error: "Password is required.",
    }).min(8, "Password must be at least 8 characters long."),
    
    program: z.string().trim().optional().default(""),
    
    semester: z.string().trim().optional().default(""),
  }),
};

export const loginSchema = {
  body: z.object({
    email: z.string({
      required_error: "Email is required.",
    }).trim().email("Please provide a valid email address."),
    
    password: z.string({
      required_error: "Password is required.",
    }).min(1, "Password cannot be empty."),
  }),
};
