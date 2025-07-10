import path from 'path';
import { UtcpClient } from '../../../src/client/utcp-client';
import { UtcpClientConfig } from '../../../src/client/utcp-client-config';
import { Job, JobSearchInput, JobSearchOutput } from './models';

const candidateProfile = {
  desiredCountry: 'United States',
};

/**
 * Initialize the UTCP client with configuration.
 */
async function initializeUtcpClient(): Promise<UtcpClient> {
  // Create a configuration for the UTCP client
  const config: UtcpClientConfig = {
    variables: {},
    providers_file_path: path.join(__dirname, 'providers.json'),
    load_variables_from: [
      {
        type: 'dotenv',
        env_file_path: path.join(__dirname, '.env')
      }
    ]
  };
  
  // Create and return the UTCP client
  const client = await UtcpClient.create(config);
  return client;
}

async function main() {
  console.log('Initializing UTCP client...');

  // Create UTCP client with providers.json in this directory
  const client = await initializeUtcpClient();

  const tools = await client.toolRepository.getTools();

  if (tools.length === 0) {
    console.log('No tools found. Make sure the example server is running.');
    return;
  }

  console.log('Registered tools:');
  for (const tool of tools) {
    console.log(` - ${tool.name}`);
  }

  const searchParams: JobSearchInput = {
    page: 0,
    limit: 1,
    job_country_code_or: ['US'],
    posted_at_max_age_days: 7,
  };

  try {
    // Step 1: Search job platform (Theirstack)
    console.log('Searching Job TheirStack...');
    const theirstackResp = await client.call_tool('theirstack.job_search_post', {
      body: searchParams,
    });

    const theirstack = theirstackResp as JobSearchOutput;

    const allJobs: Job[] = theirstack.data;

    console.log(`Found ${allJobs.length} job opportunities on TheirStack.`);
    console.log('Job opportunities:');
    for (const job of allJobs) {
      console.log(`- ${job.job_title} at ${job.company} (${job.country}, Remote: ${job.remote})`);
    }

    // Step 2: Filter relevant jobs
    const relevantJobs = allJobs.filter(
      (job) =>
        job.remote ? true : job.country.toLowerCase().includes(candidateProfile.desiredCountry.toLowerCase())
    );

    console.log('Relevant job opportunities:');
    for (const job of relevantJobs) {
      console.log(`- ${job.job_title} at ${job.company} (${job.country}, Remote: ${job.remote})`);
    }
    // #########################################################################################

    // Step 3: Draft personalized cover letters
    // const applications: ApplicationRecord[] = [];

    // for (const job of relevantJobs) {
    //   console.log(`Drafting cover letter for job ${job.id} at ${job.company}...`);
    //   const coverLetter = await client.call_tool("coverlettergenerator", {
    //     job,
    //     candidateProfile,
    //     apiKey: process.env.COVERLETTERGENERATOR_API_KEY,
    //   });
    //   applications.push({
    //     jobId: job.id,
    //     company: job.company,
    //     status: 'applied',
    //     coverLetter: coverLetter as string,
    //   });
    // }

    // Step 4: Track application status
    // for (const application of applications) {
    //   console.log(`Tracking application status for job ${application.jobId} at ${application.company}...`);
    //   const status = await client.call_tool('applicationtracker', {
    //     jobId: application.jobId,
    //     company: application.company,
    //     apiKey: process.env.APPLICATIONTRACKER_API_KEY,
    //   });
    //   application.status = status as ApplicationStatus;
    //   console.log(`Application status: ${application.status}`);
    // }
  } catch (error) {
    console.error('Error in job search workflow:', error);
  }
}

main().catch((error) => {
  console.error('Unexpected error:', error);
});
