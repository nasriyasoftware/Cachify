import setup from './files.setup';
import stages from './files.stages';
import Test from '../../assets/Test';

const filesTest = new Test('files', { name: 'files', stages, setup });
export default filesTest;