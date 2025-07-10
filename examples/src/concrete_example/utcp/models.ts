export interface JobSearchInput {
  page: number;
  limit: number;
  job_country_code_or: string[];
  posted_at_max_age_days: number;
}

export interface HiringTeamMember {
  first_name: string;
  full_name: string;
  image_url: string;
  linkedin_url: string;
  role: string;
  thumbnail_url: string;
}

export interface CompanyObject {
  name: string;
  domain: string;
  industry: string;
  country: string;
  country_code: string;
  employee_count: number;
  logo: string;
  num_jobs: number;
  num_technologies: number;
  possible_domains: string[];
}

export interface Job {
  id: number;
  job_title: string;
  url: string;
  date_posted: string;
  has_blurred_data: boolean;
  company: string;
  final_url: string;
  source_url: string;
  location: string;
  short_location: string;
  long_location: string;
  state_code: string;
  latitude: number;
  longitude: number;
  postal_code: string;
  remote: boolean;
  hybrid: boolean;
  salary_string: string;
  min_annual_salary: number;
  min_annual_salary_usd: number;
  max_annual_salary: number;
  max_annual_salary_usd: number;
  avg_annual_salary_usd: number;
  salary_currency: string;
  country: string;
  seniority: string;
  country_codes: string[];
  country_code: string;
  discovered_at: string;
  company_domain: string;
  hiring_team: HiringTeamMember[];
  reposted: boolean;
  date_reposted: string;
  employment_statuses: string[];
  easy_apply: boolean;
  description: string;
  company_object: CompanyObject;
  normalized_title: string;
  manager_roles: string[];
  matching_phrases: string[];
  matching_words: string[];
}

export interface JobSearchOutput {
  metadata: {
    total_results: number;
    truncated_results: number;
    truncated_companies: number;
    total_companies: number;
  };
  data: Job[];
}
