import { z } from "zod"

// Shared by sign-up and password reset so the rule lives in one place.
const newPasswordRule = z.string().min(8, "Password must be at least 8 characters")

export const signUpSchema = z.object({
  fullName: z.string().min(2, "Please enter your full name").max(120),
  email: z.string().email("Please enter a valid email"),
  password: newPasswordRule,
})

export type SignUpInput = z.infer<typeof signUpSchema>

export const signInSchema = z.object({
  email: z.string().email("Please enter a valid email"),
  password: z.string().min(1, "Please enter your password"),
})

export type SignInInput = z.infer<typeof signInSchema>

export const forgotPasswordSchema = signInSchema.pick({ email: true })

export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>

export const resetPasswordSchema = z
  .object({
    password: newPasswordRule,
    confirmPassword: z.string().min(1, "Please confirm your new password"),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
  })

export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>
