import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../utils/api';
import toast from 'react-hot-toast';
import {
  Settings,
  Smartphone,
  Clock,
  Bot,
  Users,
  Lock,
  Info,
  Phone,
  Mail,
  MapPin,
  Globe,
  Plus,
  Trash2,
  Edit,
  Save,
  X,
  Check,
  AlertTriangle
} from 'lucide-react';

export default function SettingsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const isAdmin = user?.role === 'admin';

  const [settings, setSettings] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  
  // WhatsApp numbers
  const [whatsappNumbers, setWhatsappNumbers] = useState([]);
  const [showAddNumber, setShowAddNumber] = useState(false);
  const [newNumber, setNewNumber] = useState({ label: '', number: '', primary: false });
  
  // Follow-up settings
  const [followUpEnabled, setFollowUpEnabled] = useState(true);
  const [followUpTimings] = useState({
    stage1: '3 hours',
    stage2: '1 day',
    stage3: '3 days',
    stage4: '7 days'
  });
  
  // AI Model override
  const [aiModel, setAiModel] = useState('auto');
  const [availableModels] = useState([
    { value: 'auto', label: 'Auto (fallback chain)' },
    { value: 'gpt-4', label: 'GPT-4' },
    { value: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo' },
    { value: 'claude-3-opus', label: 'Claude 3 Opus' },
    { value: 'claude-3-sonnet', label: 'Claude 3 Sonnet' }
  ]);
  
  // Staff management
  const [staff, setStaff] = useState([]);
  const [showAddStaff, setShowAddStaff] = useState(false);
  const [newStaff, setNewStaff] = useState({ name: '', email: '', password: '', role: 'staff' });
  
  // Password change
  const [passwordForm, setPasswordForm] = useState({ current: '', new: '', confirm: '' });
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  
  // Resort info
  const [resortInfo] = useState({
    name: 'Nandibaag Resort',
    phone: '+91 XXXXX XXXXX',
    email: 'info@nandibaag.com',
    address: 'Nandibaag, Maharashtra, India',
    website: 'www.nandibaag.com',
    checkIn: '2:00 PM',
    checkOut: '11:00 AM',
    policies: [
      'Valid ID proof required at check-in',
      'Unmarried couples not allowed',
      'Outside food not permitted',
      'Pets allowed on request'
    ]
  });

  // Fetch settings
  const fetchSettings = async () => {
    try {
      const response = await api.get('/settings');
      setSettings(response.data.settings);
      setFollowUpEnabled(response.data.settings.followUpEnabled);
      setAiModel(response.data.settings.aiModelOverride || 'auto');
    } catch (error) {
      console.error('Failed to fetch settings:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // Fetch WhatsApp numbers
  const fetchWhatsappNumbers = async () => {
    try {
      const response = await api.get('/whatsapp/sessions');
      setWhatsappNumbers(Object.entries(response.data.sessions).map(([label, status]) => ({
        label,
        status,
        number: label // In real implementation, this would come from DB
      })));
    } catch (error) {
      console.error('Failed to fetch WhatsApp numbers:', error);
    }
  };

  // Fetch staff
  const fetchStaff = async () => {
    try {
      const response = await api.get('/auth/staff');
      setStaff(response.data.staff);
    } catch (error) {
      console.error('Failed to fetch staff:', error);
    }
  };

  useEffect(() => {
    fetchSettings();
    fetchWhatsappNumbers();
    if (isAdmin) {
      fetchStaff();
    }
  }, [isAdmin]);

  const handleToggleFollowUps = async () => {
    try {
      await api.patch('/settings/follow-ups', { followUpEnabled: !followUpEnabled });
      setFollowUpEnabled(!followUpEnabled);
      toast.success(`Follow-ups ${!followUpEnabled ? 'enabled' : 'disabled'}`);
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to update follow-ups');
    }
  };

  const handleUpdateAIModel = async (model) => {
    try {
      await api.patch('/settings/ai-model', { aiModelOverride: model });
      setAiModel(model);
      toast.success('AI model updated');
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to update AI model');
    }
  };

  const handleAddStaff = async () => {
    try {
      await api.post('/auth/staff', newStaff);
      toast.success('Staff member added');
      setShowAddStaff(false);
      setNewStaff({ name: '', email: '', password: '', role: 'staff' });
      fetchStaff();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to add staff');
    }
  };

  const handleDeactivateStaff = async (staffId) => {
    try {
      await api.patch(`/auth/staff/${staffId}`, { isActive: false });
      toast.success('Staff member deactivated');
      fetchStaff();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to deactivate staff');
    }
  };

  const handleChangePassword = async () => {
    if (passwordForm.new !== passwordForm.confirm) {
      toast.error('Passwords do not match');
      return;
    }
    
    try {
      await api.post('/auth/change-password', {
        currentPassword: passwordForm.current,
        newPassword: passwordForm.new
      });
      toast.success('Password changed successfully');
      setShowPasswordForm(false);
      setPasswordForm({ current: '', new: '', confirm: '' });
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to change password');
    }
  };

  if (isLoading) {
    return (
      <div className="p-4 pb-20 md:pb-4">
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-whatsapp"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 pb-20 md:pb-4">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-2xl font-bold text-gray-800 mb-6">Settings</h1>

        {/* WhatsApp Numbers Management (Admin) */}
        {isAdmin && (
          <div className="bg-white rounded-lg shadow p-6 mb-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Smartphone size={20} />
                WhatsApp Numbers
              </h2>
              <button
                onClick={() => navigate('/connect')}
                className="text-sm text-whatsapp hover:text-whatsapp-light"
              >
                Manage Connections →
              </button>
            </div>
            <div className="space-y-3">
              {whatsappNumbers.map((num) => (
                <div key={num.label} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <div>
                    <p className="font-medium">{num.label}</p>
                    <p className="text-sm text-gray-600">{num.number}</p>
                  </div>
                  <span className={`text-xs px-2 py-1 rounded-full ${
                    num.status === 'connected' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                  }`}>
                    {num.status}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Follow-up System */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h2 className="text-lg font-semibold flex items-center gap-2 mb-4">
            <Clock size={20} />
            Follow-up System
          </h2>
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-sm text-gray-600">Automated follow-up messages for leads</p>
              {isAdmin && (
                <p className="text-xs text-gray-500 mt-1">
                  Stage timings: {followUpTimings.stage1}, {followUpTimings.stage2}, {followUpTimings.stage3}, {followUpTimings.stage4}
                </p>
              )}
            </div>
            {isAdmin && (
              <button
                onClick={handleToggleFollowUps}
                className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                  followUpEnabled
                    ? 'bg-whatsapp text-white hover:bg-whatsapp-light'
                    : 'bg-gray-200 text-gray-800 hover:bg-gray-300'
                }`}
              >
                {followUpEnabled ? 'Enabled' : 'Disabled'}
              </button>
            )}
          </div>
          {!isAdmin && (
            <div className="text-sm text-gray-600">
              <p className="font-medium mb-2">Follow-up Schedule:</p>
              <ul className="space-y-1">
                <li>• Stage 1: {followUpTimings.stage1}</li>
                <li>• Stage 2: {followUpTimings.stage2}</li>
                <li>• Stage 3: {followUpTimings.stage3}</li>
                <li>• Stage 4: {followUpTimings.stage4}</li>
              </ul>
            </div>
          )}
        </div>

        {/* AI Model Override (Admin) */}
        {isAdmin && (
          <div className="bg-white rounded-lg shadow p-6 mb-6">
            <h2 className="text-lg font-semibold flex items-center gap-2 mb-4">
              <Bot size={20} />
              AI Model Override
            </h2>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Force specific AI model
              </label>
              <select
                value={aiModel}
                onChange={(e) => handleUpdateAIModel(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-whatsapp"
              >
                {availableModels.map((model) => (
                  <option key={model.value} value={model.value}>
                    {model.label}
                  </option>
                ))}
              </select>
              <p className="text-xs text-gray-500 mt-2">
                Auto mode uses fallback chain: GPT-4 → Claude 3 Opus → GPT-3.5 Turbo
              </p>
            </div>
          </div>
        )}

        {/* Staff Management (Admin) */}
        {isAdmin && (
          <div className="bg-white rounded-lg shadow p-6 mb-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Users size={20} />
                Staff Management
              </h2>
              <button
                onClick={() => setShowAddStaff(true)}
                className="flex items-center gap-2 text-sm bg-whatsapp text-white px-3 py-2 rounded-lg hover:bg-whatsapp-light"
              >
                <Plus size={16} />
                Add Staff
              </button>
            </div>
            <div className="space-y-3">
              {staff.map((member) => (
                <div key={member._id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <div>
                    <p className="font-medium">{member.name}</p>
                    <p className="text-sm text-gray-600">{member.email}</p>
                    <span className={`text-xs px-2 py-0.5 rounded-full mt-1 inline-block ${
                      member.role === 'admin' ? 'bg-purple-100 text-purple-800' : 'bg-blue-100 text-blue-800'
                    }`}>
                      {member.role}
                    </span>
                  </div>
                  {member.isActive ? (
                    <button
                      onClick={() => handleDeactivateStaff(member._id)}
                      className="text-red-600 hover:text-red-700 text-sm"
                    >
                      Deactivate
                    </button>
                  ) : (
                    <span className="text-gray-400 text-sm">Inactive</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Change Password (All Users) */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h2 className="text-lg font-semibold flex items-center gap-2 mb-4">
            <Lock size={20} />
            Change Password
          </h2>
          {!showPasswordForm ? (
            <button
              onClick={() => setShowPasswordForm(true)}
              className="text-sm bg-gray-100 text-gray-800 px-4 py-2 rounded-lg hover:bg-gray-200"
            >
              Change Password
            </button>
          ) : (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Current Password
                </label>
                <input
                  type="password"
                  value={passwordForm.current}
                  onChange={(e) => setPasswordForm({ ...passwordForm, current: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-whatsapp"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  New Password
                </label>
                <input
                  type="password"
                  value={passwordForm.new}
                  onChange={(e) => setPasswordForm({ ...passwordForm, new: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-whatsapp"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Confirm New Password
                </label>
                <input
                  type="password"
                  value={passwordForm.confirm}
                  onChange={(e) => setPasswordForm({ ...passwordForm, confirm: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-whatsapp"
                />
              </div>
              <div className="flex gap-3">
                <button
                  onClick={handleChangePassword}
                  className="flex-1 bg-whatsapp text-white py-2 rounded-lg hover:bg-whatsapp-light"
                >
                  Update Password
                </button>
                <button
                  onClick={() => {
                    setShowPasswordForm(false);
                    setPasswordForm({ current: '', new: '', confirm: '' });
                  }}
                  className="flex-1 bg-gray-200 text-gray-800 py-2 rounded-lg hover:bg-gray-300"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Resort Info (Read-only) */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h2 className="text-lg font-semibold flex items-center gap-2 mb-4">
            <Info size={20} />
            Resort Information
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <p className="text-sm text-gray-600 mb-1">Name</p>
              <p className="font-medium">{resortInfo.name}</p>
            </div>
            <div>
              <p className="text-sm text-gray-600 mb-1">Phone</p>
              <p className="font-medium flex items-center gap-2">
                <Phone size={16} />
                {resortInfo.phone}
              </p>
            </div>
            <div>
              <p className="text-sm text-gray-600 mb-1">Email</p>
              <p className="font-medium flex items-center gap-2">
                <Mail size={16} />
                {resortInfo.email}
              </p>
            </div>
            <div>
              <p className="text-sm text-gray-600 mb-1">Website</p>
              <p className="font-medium flex items-center gap-2">
                <Globe size={16} />
                {resortInfo.website}
              </p>
            </div>
            <div className="md:col-span-2">
              <p className="text-sm text-gray-600 mb-1">Address</p>
              <p className="font-medium flex items-center gap-2">
                <MapPin size={16} />
                {resortInfo.address}
              </p>
            </div>
            <div>
              <p className="text-sm text-gray-600 mb-1">Check-in</p>
              <p className="font-medium">{resortInfo.checkIn}</p>
            </div>
            <div>
              <p className="text-sm text-gray-600 mb-1">Check-out</p>
              <p className="font-medium">{resortInfo.checkOut}</p>
            </div>
          </div>
          <div className="mt-4 pt-4 border-t">
            <p className="text-sm font-medium text-gray-700 mb-2">Policies</p>
            <ul className="space-y-1">
              {resortInfo.policies.map((policy, index) => (
                <li key={index} className="text-sm text-gray-600 flex items-start gap-2">
                  <span className="text-whatsapp">•</span>
                  {policy}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {/* Add Staff Modal */}
      {showAddStaff && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Add Staff Member</h3>
              <button onClick={() => setShowAddStaff(false)} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                <input
                  type="text"
                  value={newStaff.name}
                  onChange={(e) => setNewStaff({ ...newStaff, name: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-whatsapp"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                <input
                  type="email"
                  value={newStaff.email}
                  onChange={(e) => setNewStaff({ ...newStaff, email: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-whatsapp"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Temporary Password</label>
                <input
                  type="password"
                  value={newStaff.password}
                  onChange={(e) => setNewStaff({ ...newStaff, password: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-whatsapp"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
                <select
                  value={newStaff.role}
                  onChange={(e) => setNewStaff({ ...newStaff, role: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-whatsapp"
                >
                  <option value="staff">Staff</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={handleAddStaff}
                  className="flex-1 bg-whatsapp text-white py-2 rounded-lg hover:bg-whatsapp-light"
                >
                  Add Staff
                </button>
                <button
                  onClick={() => setShowAddStaff(false)}
                  className="flex-1 bg-gray-200 text-gray-800 py-2 rounded-lg hover:bg-gray-300"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
